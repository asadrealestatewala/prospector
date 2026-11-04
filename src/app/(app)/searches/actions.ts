"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { checkGoogleSpend } from "@/lib/engine/budget";
import { estimateCalls } from "@/lib/engine/estimate";
import { searchOptionsSchema } from "@/lib/engine/search-options";
import { queueSearch } from "@/lib/engine/start-search";
import { findCity } from "@/lib/engine/cities";
import type { Product } from "@/components/ui/chips";

export type ActionResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  console.error("search action failed", e instanceof Error ? e.message : e);
  return { ok: false, error: "Something went wrong. Nothing was changed. Try again." };
}

const locationSchema = z.object({
  city: z.string().trim().min(1).max(80),
  area: z.string().trim().max(80).nullable(),
  radiusKm: z.coerce.number().min(1).max(50).nullable(),
});

const searchInput = z.object({
  name: z.string().trim().max(120).optional(),
  product: z.enum(["classwell", "vetlin", "postwala"]),
  businessType: z.string().trim().max(80).nullable(),
  keywords: z.array(z.string().trim().min(2).max(80)).min(1, "Add at least one business type or keyword.").max(10, "Use at most 10 keywords."),
  locations: z.array(locationSchema).min(1, "Choose at least one city.").max(300, "Choose at most 300 cities and areas in one search."),
  options: searchOptionsSchema,
});
export type SearchInput = z.input<typeof searchInput>;

export type Estimate = {
  calls: number;
  costPkr: number | null;
  remainingPkr: number | null;
  ok: boolean;
  message: string | null;
  warning: string | null;
};

/** Step 5, Review: estimated calls and Google cost against the remaining budget. */
export async function estimateSearch(raw: SearchInput): Promise<ActionResult<Estimate>> {
  try {
    await requireRole("admin", "lead_expert");
    const v = searchInput.parse(raw);
    const calls = estimateCalls({ locations: v.locations.length, keywords: v.keywords.length, maxPerCity: v.options.maxPerCity });
    const check = await checkGoogleSpend(createSupabaseAdminClient(), v.product as Product, calls);
    return {
      ok: true,
      message: "Estimated",
      data: { calls, costPkr: check.costPkr, remainingPkr: check.remainingPkr, ok: check.ok, message: check.message, warning: check.warning },
    };
  } catch (e) {
    return fail(e);
  }
}

function defaultName(v: z.infer<typeof searchInput>) {
  const cities = [...new Set(v.locations.map((l) => l.city))];
  const where = cities.length <= 2 ? cities.join(" and ") : `${cities.length} cities`;
  return `${v.businessType || v.keywords[0]} in ${where}`;
}

/**
 * Creates the search and its city rows. mode "now" queues it after the budget check,
 * "schedule" sets it to start at a Pakistan-time moment, "template" saves it for reuse only.
 */
export async function createSearch(
  raw: SearchInput,
  mode: "now" | "schedule" | "template",
  scheduledAtPk?: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    const v = searchInput.parse(raw);
    let scheduledAt: string | null = null;
    if (mode === "schedule") {
      if (!scheduledAtPk || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledAtPk)) return { ok: false, error: "Choose a date and time to start." };
      const at = new Date(`${scheduledAtPk}:00+05:00`);
      if (at.getTime() < Date.now() + 60_000) return { ok: false, error: "Choose a start time in the future (Pakistan time)." };
      scheduledAt = at.toISOString();
    }

    const supabase = await createSupabaseServerClient();
    const name = v.name?.trim() || defaultName(v);
    const calls = estimateCalls({ locations: v.locations.length, keywords: v.keywords.length, maxPerCity: v.options.maxPerCity });
    const { data: search, error } = await supabase
      .from("searches")
      .insert({
        name,
        product: v.product,
        business_types: v.businessType ? [v.businessType] : [],
        keywords: v.keywords,
        options: v.options,
        status: mode === "schedule" ? "scheduled" : "draft",
        is_saved_template: mode === "template",
        scheduled_at: scheduledAt,
        estimated_calls: calls,
        created_by: actor.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Same city and area twice is collapsed into one row.
    const seen = new Set<string>();
    const rows = v.locations
      .filter((l) => {
        const k = `${l.city.toLowerCase()}|${(l.area ?? "").toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((l) => {
        const c = findCity(l.city);
        return {
          search_id: search.id,
          city: c?.name ?? l.city,
          area: l.area || null,
          radius_m: l.radiusKm ? Math.round(l.radiusKm * 1000) : null,
          latitude: c?.lat ?? null,
          longitude: c?.lng ?? null,
          status: "queued",
        };
      });
    const { error: cityErr } = await supabase.from("search_cities").insert(rows);
    if (cityErr) {
      await supabase.from("searches").delete().eq("id", search.id);
      throw cityErr;
    }

    await writeAudit(actor, `search.${mode === "now" ? "started" : mode === "schedule" ? "scheduled" : "saved"}`, "search", search.id, {
      name,
      product: v.product,
      locations: rows.length,
      keywords: v.keywords.length,
      estimated_calls: calls,
    });

    if (mode === "now") {
      const r = await queueSearch(createSupabaseAdminClient(), search.id);
      revalidatePath("/searches");
      if (!r.ok) return { ok: false, error: `${r.message} The search was saved; start it from Live Progress once this is fixed.` };
      return { ok: true, message: r.warning ? `Search started. ${r.warning}` : "Search started.", data: { id: search.id } };
    }
    revalidatePath("/searches");
    revalidatePath("/searches/new");
    return {
      ok: true,
      message: mode === "schedule" ? "Search scheduled. It will start at the chosen time if the budget allows." : "Saved as a reusable search.",
      data: { id: search.id },
    };
  } catch (e) {
    return fail(e);
  }
}

const idSchema = z.string().uuid();

/** Starts a draft, resumes a paused search, or retries one that stopped (budget or key fixed). */
export async function startSearch(id: string): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    idSchema.parse(id);
    const supabase = await createSupabaseServerClient();
    const { data: s } = await supabase.from("searches").select("id, status, is_saved_template").eq("id", id).maybeSingle();
    if (!s) return { ok: false, error: "Search not found." };
    if (s.is_saved_template) return { ok: false, error: "This is a saved search. Use it from New Search to start a copy." };
    if (s.status === "failed") {
      // Retry failed cities as well as paused ones.
      await supabase.from("search_cities").update({ status: "queued", error: null }).eq("search_id", id).eq("status", "failed");
      await supabase.from("searches").update({ status: "paused" }).eq("id", id);
    }
    const r = await queueSearch(createSupabaseAdminClient(), id);
    if (!r.ok) return { ok: false, error: r.message };
    await writeAudit(actor, "search.resumed", "search", id, { cities: r.queued });
    revalidatePath(`/searches/${id}`);
    return { ok: true, message: r.warning ? `Search queued. ${r.warning}` : "Search queued." };
  } catch (e) {
    return fail(e);
  }
}

/** Pause stops new jobs; a page already being fetched finishes (SRS screen 4). */
export async function pauseSearch(id: string): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    idSchema.parse(id);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("searches")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["queued", "running", "scheduled"])
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, error: "Only a queued, scheduled or running search can be paused." };
    await supabase.from("search_cities").update({ status: "paused" }).eq("search_id", id).eq("status", "queued");
    await writeAudit(actor, "search.paused", "search", id);
    revalidatePath(`/searches/${id}`);
    return { ok: true, message: "Search paused. Cities already running finish their current page." };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelSearch(id: string): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    idSchema.parse(id);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("searches")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), finished_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["draft", "queued", "running", "paused", "scheduled"])
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, error: "This search has already finished." };
    await supabase.from("search_cities").update({ status: "cancelled" }).eq("search_id", id).in("status", ["queued", "paused"]);
    await writeAudit(actor, "search.cancelled", "search", id);
    revalidatePath(`/searches/${id}`);
    return { ok: true, message: "Search cancelled. Leads already saved are kept." };
  } catch (e) {
    return fail(e);
  }
}

/** Failure panel Retry: queues one website crawl again (the crawler arrives in step 3). */
export async function retryCrawl(crawlJobId: string): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    idSchema.parse(crawlJobId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("crawl_jobs")
      .update({ status: "queued", error_reason: null, retries: 0, started_at: null, finished_at: null })
      .eq("id", crawlJobId)
      .in("status", ["failed", "blocked_by_robots"])
      .select("id, search_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "That crawl is not in a failed state." };
    await writeAudit(actor, "crawl.retried", "crawl_job", crawlJobId);
    return { ok: true, message: "Website queued to crawl again." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSavedSearch(id: string): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    idSchema.parse(id);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("searches").delete().eq("id", id).eq("is_saved_template", true);
    if (error) throw error;
    await writeAudit(actor, "search.saved_deleted", "search", id);
    revalidatePath("/searches/new");
    return { ok: true, message: "Saved search removed." };
  } catch (e) {
    return fail(e);
  }
}
