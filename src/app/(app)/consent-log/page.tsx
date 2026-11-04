import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyConsentFilters, consentFilterSchema, flatParams } from "@/lib/compliance/filters";
import { ConsentScreen, type ConsentRow } from "./consent-screen";

export const metadata: Metadata = { title: "Consent Log" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireScreen("consent-log");
  const filters = consentFilterSchema.parse(flatParams(await searchParams));
  const page = filters.page ?? 0;
  const size = filters.size ?? 50;
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("consent_log_view")
    .select("id, occurred_at, lead_id, lead_name, product, channel, value, event, source, source_url, note, recorded_by_name, recorded_by_system", { count: "exact" });
  q = applyConsentFilters(q, filters);
  const { data, count, error } = await q.order("occurred_at", { ascending: false }).order("id").range(page * size, page * size + size - 1);

  let leadName: string | null = null;
  if (filters.lead) {
    const { data: l } = await supabase.from("leads").select("name").eq("id", filters.lead).maybeSingle();
    leadName = l?.name ?? "Deleted lead";
  }
  return (
    <ConsentScreen
      rows={(data ?? []) as ConsentRow[]}
      total={count ?? 0}
      filters={filters}
      page={page}
      size={size}
      leadName={leadName}
      loadError={error ? "Could not load the consent log. Try again." : null}
    />
  );
}
