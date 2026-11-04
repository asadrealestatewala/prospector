import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyLeadFilters, parseLeadFilters } from "@/lib/leads/filters";
import { LEAD_COLUMNS_COOKIE, DEFAULT_HIDDEN, LEAD_LIST_SELECT } from "@/lib/leads/columns";
import { LeadsScreen, type LeadRow } from "./leads-screen";

export const metadata: Metadata = { title: "Leads" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireScreen("leads");
  const filters = parseLeadFilters(await searchParams);
  const supabase = await createSupabaseServerClient();

  const page = filters.page ?? 0;
  const size = filters.size ?? 50;
  const sort = filters.sort ?? "created_at";
  const select = filters.consent ? `${LEAD_LIST_SELECT}, lead_contacts!inner(consent_state)` : LEAD_LIST_SELECT;

  // Exact counts are slow on very large tables; "planned" is close enough above 10,000 rows.
  let query = supabase.from("leads").select(select, { count: "exact" });
  query = applyLeadFilters(query, filters);
  const { data, count, error } = await query
    .order(sort, { ascending: (filters.dir ?? (sort === "name" || sort === "city" ? "asc" : "desc")) === "asc", nullsFirst: false })
    .order("id")
    .range(page * size, page * size + size - 1);

  const [{ data: owners }, { data: searches }, { data: views }, { data: cityRows }] = await Promise.all([
    supabase.from("users").select("id, full_name").eq("status", "active").order("full_name"),
    supabase.from("searches").select("id, name").eq("is_saved_template", false).order("created_at", { ascending: false }).limit(100),
    supabase.from("saved_views").select("id, name, params, columns, is_shared, user_id").eq("screen", "leads").order("name"),
    supabase.from("search_cities").select("city").limit(1000),
  ]);

  const hiddenCookie = (await cookies()).get(LEAD_COLUMNS_COOKIE)?.value;
  const hidden = hiddenCookie ? hiddenCookie.split(".").filter(Boolean) : DEFAULT_HIDDEN;

  const rows = ((data ?? []) as unknown as (Omit<LeadRow, "ownerName" | "sourceName"> & { owner: { full_name: string } | null; source: { name: string } | null })[]).map(
    ({ owner, source, ...l }) => ({ ...l, ownerName: owner?.full_name ?? null, sourceName: source?.name ?? null }),
  );

  return (
    <LeadsScreen
      rows={rows}
      total={count ?? 0}
      loadError={error ? "Could not load leads. Try again, or remove a filter." : null}
      filters={filters}
      page={page}
      size={size}
      sort={{ key: sort, dir: filters.dir ?? (sort === "name" || sort === "city" ? "asc" : "desc") }}
      owners={owners ?? []}
      searches={searches ?? []}
      cities={[...new Set((cityRows ?? []).map((c) => c.city))].sort()}
      views={(views ?? []).map((v) => ({ ...v, mine: v.user_id === user.id }))}
      hidden={hidden}
      canDelete={["admin", "manager", "lead_expert"].includes(user.role)}
      canVerify={["admin", "lead_expert"].includes(user.role)}
    />
  );
}
