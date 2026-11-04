import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireScreen } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LiveProgress, type Progress } from "./live-progress";

export const metadata: Metadata = { title: "Live Progress" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireScreen("live-progress");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();

  const { data: search } = await supabase
    .from("searches")
    .select("id, name, product, status, keywords, options, error, created_at, started_at, finished_at, scheduled_at, estimated_calls, estimated_cost_pkr, actual_calls, actual_cost_pkr, is_saved_template")
    .eq("id", id)
    .maybeSingle();
  if (!search || search.is_saved_template) notFound();

  const [{ data: cities }, { data: progress }, { data: feed }, { data: failures }] = await Promise.all([
    supabase
      .from("search_cities")
      .select("id, city, area, status, found_count, saved_count, duplicate_count, api_calls, keyword_index, error")
      .eq("search_id", id)
      .order("city")
      .order("area", { nullsFirst: true }),
    supabase.rpc("search_progress", { p_search_id: id }),
    supabase
      .from("leads")
      .select("id, name, city, area, phone, website, google_rating, created_at")
      .eq("source_search_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("crawl_jobs")
      .select("id, url, status, error_reason, retries, finished_at, lead_id, leads(name)")
      .eq("search_id", id)
      .in("status", ["failed", "blocked_by_robots"])
      .order("finished_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <LiveProgress
      search={search}
      cities={cities ?? []}
      progress={(progress ?? {}) as Progress}
      feed={feed ?? []}
      failures={(failures ?? []).map((f) => ({ ...f, leadName: (f.leads as unknown as { name: string } | null)?.name ?? null }))}
      canControl={canAccess(user.role, "new-search")}
    />
  );
}
