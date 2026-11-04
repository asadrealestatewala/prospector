import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyDncFilters, dncFilterSchema, flatParams } from "@/lib/compliance/filters";
import { DncScreen, type DncRow } from "./dnc-screen";

export const metadata: Metadata = { title: "Do-Not-Contact" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireScreen("do-not-contact");
  const filters = dncFilterSchema.parse(flatParams(await searchParams));
  const page = filters.page ?? 0;
  const size = filters.size ?? 50;
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("do_not_contact")
    .select(
      "id, channel, value, reason, note, source, added_by_system, created_at, removed_at, removal_reason, lead_id, lead:leads(name), adder:users!do_not_contact_added_by_fkey(full_name), remover:users!do_not_contact_removed_by_fkey(full_name)",
      { count: "exact" },
    );
  q = applyDncFilters(q, filters);
  const { data, count, error } = await q.order(filters.removed ? "removed_at" : "created_at", { ascending: false }).order("id").range(page * size, page * size + size - 1);

  const rows: DncRow[] = ((data ?? []) as unknown as (Omit<DncRow, "leadName" | "addedBy" | "removedBy"> & {
    lead: { name: string } | null;
    adder: { full_name: string } | null;
    remover: { full_name: string } | null;
  })[]).map(({ lead, adder, remover, ...r }) => ({ ...r, leadName: lead?.name ?? null, addedBy: adder?.full_name ?? null, removedBy: remover?.full_name ?? null }));

  return <DncScreen rows={rows} total={count ?? 0} filters={filters} page={page} size={size} loadError={error ? "Could not load the list. Try again." : null} />;
}
