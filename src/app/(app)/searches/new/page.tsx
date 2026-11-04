import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { PROVINCE_GROUPS, type CityGroup } from "@/lib/engine/cities";
import { parseSearchOptions } from "@/lib/engine/search-options";
import { NewSearchForm, type SavedSearch } from "./new-search-form";

export const metadata: Metadata = { title: "New Search" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireScreen("new-search");
  const { from } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: templates } = await supabase
    .from("searches")
    .select("id, name, product, business_types, keywords, options, search_cities(city, area, radius_m)")
    .eq("is_saved_template", true)
    .order("created_at", { ascending: false })
    .limit(50);

  // City groups are a setting (Admin-only to read), so the server reads them for every role.
  const { data: groupsRow } = await createSupabaseAdminClient().from("settings").select("value").eq("key", "search.city_groups").maybeSingle();
  const custom = Array.isArray(groupsRow?.value) ? (groupsRow.value as CityGroup[]).filter((g) => g && typeof g.name === "string" && Array.isArray(g.cities)) : [];

  const saved: SavedSearch[] = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    product: t.product,
    businessType: (t.business_types as string[])[0] ?? null,
    keywords: t.keywords as string[],
    options: parseSearchOptions(t.options),
    locations: ((t.search_cities as { city: string; area: string | null; radius_m: number | null }[]) ?? []).map((c) => ({
      city: c.city,
      area: c.area,
      radiusKm: c.radius_m ? c.radius_m / 1000 : null,
    })),
  }));

  return (
    <>
      <PageHeader title="New Search" description="Find businesses on Google for one product, then save them as leads." />
      <NewSearchForm saved={saved} groups={[...PROVINCE_GROUPS, ...custom]} initialFrom={from ?? null} />
    </>
  );
}
