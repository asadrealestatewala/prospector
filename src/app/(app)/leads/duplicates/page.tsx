import type { Metadata } from "next";
import Link from "next/link";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { DuplicatesScreen, type DupGroup } from "./duplicates-screen";

export const metadata: Metadata = { title: "Duplicate leads" };

/**
 * Duplicate-merge tool (SRS screen 5). Exact matches on place ID, phone and website are already
 * blocked by the database; this finds near matches by business name within a city.
 */
export default async function Page() {
  await requireScreen("leads");
  const supabase = await createSupabaseServerClient();
  const { data: groups } = await supabase.rpc("lead_duplicate_groups", { p_limit: 100 });
  const allIds = ((groups ?? []) as { lead_ids: string[] }[]).flatMap((g) => g.lead_ids);
  const { data: leads } = allIds.length
    ? await supabase
        .from("leads")
        .select("id, name, product, city, area, phone, website, email, whatsapp, status, score, created_at")
        .in("id", allIds.slice(0, 1000))
    : { data: [] };
  const byId = new Map((leads ?? []).map((l) => [l.id, l]));
  const result: DupGroup[] = ((groups ?? []) as { name_key: string; city: string | null; lead_ids: string[] }[]).map((g) => ({
    key: `${g.name_key}|${g.city ?? ""}`,
    city: g.city,
    leads: g.lead_ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l),
  })).filter((g) => g.leads.length > 1);

  return (
    <>
      <PageHeader
        title="Duplicate leads"
        description="Businesses with the same name in the same city. Choose the record to keep; contacts, notes and history from the others move to it."
        actions={<Link href="/leads" className="text-body text-brand-600 hover:underline">Back to Leads</Link>}
      />
      <DuplicatesScreen groups={result} />
    </>
  );
}
