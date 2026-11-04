import type { SupabaseClient } from "@supabase/supabase-js";
import { UnrecoverableError, type Job } from "bullmq";
import { checkGoogleSpend, GOOGLE_ITEM, GOOGLE_PROVIDER } from "@/lib/engine/budget";
import { PlacesError, searchPlacesPage, type PlaceResult } from "@/lib/engine/places";
import { parseSearchOptions } from "@/lib/engine/search-options";
import type { PlacesJob } from "@/lib/engine/queue";
import type { Product } from "@/components/ui/chips";

/**
 * places-search queue (SRS 8.3): searches one city (or city area) for every keyword of its search,
 * pages through results, saves leads and queues website crawls.
 *
 * Safe to retry: the job claims its city row first, keeps a checkpoint (keyword and page token)
 * after every page, and leads are de-duplicated by the database's unique keys.
 * Pausing stops before the next page; the page already running finishes (SRS screen 4).
 */
export type PlacesDeps = {
  db: SupabaseClient;
  getApiKey: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Wait between pages, so Google's page token is ready. */
  pageDelayMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

type CityRow = {
  id: string;
  search_id: string;
  city: string;
  area: string | null;
  radius_m: number | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  keyword_index: number;
  next_page_token: string | null;
  found_count: number;
  saved_count: number;
  duplicate_count: number;
  api_calls: number;
  cost_pkr: number;
  job_id: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processPlacesJob(job: Pick<Job<PlacesJob>, "id" | "data">, deps: PlacesDeps): Promise<string> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const jobId = String(job.id);

  // Claim the city. A retry of the same job may take over its own running row.
  const { data: claimed } = await db
    .from("search_cities")
    .update({ status: "running", job_id: jobId, started_at: new Date().toISOString() })
    .eq("id", job.data.searchCityId)
    .or(`status.eq.queued,and(status.eq.running,job_id.eq.${jobId})`)
    .select("*")
    .maybeSingle();
  if (!claimed) return "skipped: city not queued";
  let city = claimed as CityRow;

  const { data: search } = await db
    .from("searches")
    .select("id, name, product, keywords, options, status, started_at")
    .eq("id", city.search_id)
    .single();
  if (!search) throw new UnrecoverableError("search missing");

  if (search.status === "paused" || search.status === "cancelled") {
    await db.from("search_cities").update({ status: search.status }).eq("id", city.id);
    return `stopped: search ${search.status}`;
  }
  if (search.status === "queued" || search.status === "scheduled") {
    await db
      .from("searches")
      .update({ status: "running", started_at: search.started_at ?? new Date().toISOString() })
      .eq("id", search.id)
      .in("status", ["queued", "scheduled"]);
  }

  const apiKey = await deps.getApiKey();
  if (!apiKey) {
    await failCity(db, city.id, "The Google Places API key is not set.");
    await stopSearch(db, search.id, "failed", "The Google Places API key is not set. An Admin must add it on the Settings screen.");
    return "failed: no key";
  }

  const options = parseSearchOptions(search.options);
  const keywords = (search.keywords as string[]) ?? [];
  const product = search.product as Product;
  let ki = city.keyword_index;
  let token = city.next_page_token;

  while (ki < keywords.length && city.found_count < options.maxPerCity) {
    // Pause and cancel take effect before the next paid call.
    const { data: now } = await db.from("searches").select("status").eq("id", search.id).single();
    if (now?.status === "paused" || now?.status === "cancelled") {
      await db.from("search_cities").update({ status: now.status }).eq("id", city.id);
      return `stopped: search ${now.status}`;
    }

    // Budget and price are read at the moment of use, before every call (SRS 8.4).
    const spend = await checkGoogleSpend(db, product, 1);
    if (!spend.ok) {
      await db.from("search_cities").update({ status: "paused", error: spend.message }).eq("id", city.id);
      await stopSearch(db, search.id, "paused", spend.message);
      log("budget stop", { searchId: search.id });
      return "paused: budget";
    }

    let page;
    try {
      page = await searchPlacesPage({
        apiKey,
        keyword: keywords[ki],
        city: city.city,
        area: city.area,
        pageToken: token,
        minRating: options.minRating,
        circle: city.radius_m && city.latitude !== null && city.longitude !== null
          ? { lat: city.latitude, lng: city.longitude, radiusM: city.radius_m }
          : null,
        fetchImpl: deps.fetchImpl,
      });
    } catch (e) {
      if (e instanceof PlacesError && e.fatal) {
        // A rejected key or exhausted quota will not fix itself on retry.
        await failCity(db, city.id, e.message);
        if (e.status === 401 || e.status === 403 || e.status === 429) {
          await stopSearch(db, search.id, "paused", `${e.message}. Check the Google key and quota in Settings, then resume.`);
        }
        await db.rpc("finish_search_if_complete", { p_search_id: search.id });
        throw new UnrecoverableError(e.message);
      }
      // Network trouble: BullMQ retries the job, which carries on from the checkpoint.
      await db.from("search_cities").update({ error: e instanceof Error ? e.message : "Google request failed" }).eq("id", city.id);
      throw e;
    }

    // The call was made, so it is charged whatever it returned.
    await db.rpc("record_api_usage", {
      p_provider: GOOGLE_PROVIDER,
      p_item: GOOGLE_ITEM,
      p_product: product,
      p_calls: 1,
      p_cost_pkr: spend.costPkr ?? 0,
      p_rate_id: spend.rateId,
    });

    const counts = await savePlaces(db, city, page.places, options, search.id);
    const nextKi = page.nextPageToken ? ki : ki + 1;
    const nextToken = page.nextPageToken;
    const { data: updated } = await db
      .from("search_cities")
      .update({
        found_count: city.found_count + counts.considered,
        saved_count: city.saved_count + counts.inserted,
        duplicate_count: city.duplicate_count + counts.duplicates,
        api_calls: city.api_calls + 1,
        cost_pkr: Number(city.cost_pkr) + (spend.costPkr ?? 0),
        keyword_index: nextKi,
        next_page_token: nextToken,
        error: null,
      })
      .eq("id", city.id)
      .select("*")
      .single();
    city = updated as CityRow;
    await db.rpc("refresh_search_totals", { p_search_id: search.id });

    ki = nextKi;
    token = nextToken;
    if (token && deps.pageDelayMs) await sleep(deps.pageDelayMs);
  }

  await db
    .from("search_cities")
    .update({ status: "done", finished_at: new Date().toISOString(), next_page_token: null })
    .eq("id", city.id);
  await db.rpc("finish_search_if_complete", { p_search_id: search.id });
  return `done: ${city.saved_count} saved, ${city.duplicate_count} duplicates`;
}

async function savePlaces(
  db: SupabaseClient,
  city: CityRow,
  places: PlaceResult[],
  options: ReturnType<typeof parseSearchOptions>,
  searchId: string,
) {
  let considered = 0;
  let inserted = 0;
  let duplicates = 0;
  for (const p of places) {
    if (city.found_count + considered >= options.maxPerCity) break;
    if (options.requireWebsite && !p.website) continue;
    if (options.minRating && (p.rating ?? 0) < options.minRating) continue;
    considered += 1;
    const { data, error } = await db.rpc("save_place_lead", {
      p_search_id: searchId,
      p_city: city.city,
      p_area: city.area,
      p,
      p_skip_existing: options.skipExisting,
      p_auto_crawl: options.autoCrawl,
    });
    if (error) throw new Error(`Could not save a lead: ${error.message}`);
    if (data === "inserted") inserted += 1;
    else duplicates += 1;
  }
  return { considered, inserted, duplicates };
}

async function failCity(db: SupabaseClient, cityId: string, message: string) {
  await db.from("search_cities").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", cityId);
}

async function stopSearch(db: SupabaseClient, searchId: string, status: "paused" | "failed", message: string | null) {
  await db
    .from("searches")
    .update({ status, error: message, ...(status === "paused" ? { paused_at: new Date().toISOString() } : { finished_at: new Date().toISOString() }) })
    .eq("id", searchId)
    .in("status", ["queued", "running"]);
  // Other cities waiting in the queue stop too; resuming requeues them.
  await db
    .from("search_cities")
    .update({ status: status === "paused" ? "paused" : "cancelled" })
    .eq("search_id", searchId)
    .eq("status", "queued");
}

/** Starts searches whose scheduled time has come. Runs every minute. */
export async function startDueSearches(db: SupabaseClient, queue: (id: string) => Promise<unknown>) {
  const { data } = await db
    .from("searches")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .limit(20);
  for (const s of data ?? []) await queue(s.id);
  return (data ?? []).length;
}
