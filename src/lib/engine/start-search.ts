import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGoogleSpend } from "@/lib/engine/budget";
import { estimateCalls } from "@/lib/engine/estimate";
import { parseSearchOptions } from "@/lib/engine/search-options";
import { enqueueCities } from "@/lib/engine/queue";
import type { Product } from "@/components/ui/chips";

export type QueueResult = { ok: true; queued: number; warning: string | null } | { ok: false; message: string };

/**
 * Queues every unfinished city of a search after checking the key, price and budget (SRS 8.4).
 * Used for Start now, Resume, Retry and by the scheduler for searches set for later.
 * Takes a service-role client; the caller has already checked the user's role.
 */
export async function queueSearch(db: SupabaseClient, searchId: string): Promise<QueueResult> {
  const { data: search } = await db
    .from("searches")
    .select("id, product, keywords, options, status")
    .eq("id", searchId)
    .maybeSingle();
  if (!search) return { ok: false, message: "Search not found." };
  if (["done", "cancelled", "running"].includes(search.status)) {
    return { ok: false, message: `This search is already ${search.status}.` };
  }

  const { data: cities } = await db
    .from("search_cities")
    .select("id, keyword_index, status")
    .eq("search_id", searchId)
    .in("status", ["queued", "paused"]);
  const open = cities ?? [];
  if (open.length === 0) return { ok: false, message: "This search has no cities left to run." };

  const { data: keyRow } = await db.from("settings").select("secret_ciphertext").eq("key", "google.places_api_key").maybeSingle();
  if (!keyRow?.secret_ciphertext) {
    return fail(db, searchId, search.status, "The Google Places API key is not set. An Admin must add it on the Settings screen.");
  }

  const options = parseSearchOptions(search.options);
  const keywords = (search.keywords as string[]).length;
  // Cities part-way through only need their remaining keywords.
  const remainingQueries = open.reduce((n, c) => n + Math.max(0, keywords - Number(c.keyword_index)), 0);
  const calls = estimateCalls({ locations: remainingQueries, keywords: 1, maxPerCity: options.maxPerCity });
  const verdict = await checkGoogleSpend(db, search.product as Product, calls);
  if (!verdict.ok) return fail(db, searchId, search.status, verdict.message ?? "The Google budget does not allow this search.");

  await db
    .from("searches")
    .update({ status: "queued", error: null, paused_at: null, estimated_calls: calls, estimated_cost_pkr: verdict.costPkr ?? 0 })
    .eq("id", searchId);
  await db.from("search_cities").update({ status: "queued", error: null }).in("id", open.map((c) => c.id));
  try {
    await enqueueCities(open.map((c) => c.id), String(Date.now()));
  } catch (e) {
    const message = e instanceof Error ? e.message : "The background queue is not reachable.";
    // Put the search back so it can be started again once Redis is up.
    await db.from("searches").update({ status: search.status === "scheduled" ? "scheduled" : "paused", error: message }).eq("id", searchId);
    await db.from("search_cities").update({ status: "paused" }).in("id", open.map((c) => c.id));
    return { ok: false, message };
  }
  return { ok: true, queued: open.length, warning: verdict.warning };
}

async function fail(db: SupabaseClient, searchId: string, status: string, message: string): Promise<QueueResult> {
  // A scheduled search that cannot start is marked failed so it does not retry every minute.
  await db
    .from("searches")
    .update({ error: message, ...(status === "scheduled" ? { status: "failed" } : {}) })
    .eq("id", searchId);
  return { ok: false, message };
}
