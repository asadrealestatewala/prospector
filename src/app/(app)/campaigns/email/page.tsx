import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CampaignList, type CampaignListRow } from "./campaign-list";
import { ZERO_COUNTS, type Counts } from "./status";

export const metadata: Metadata = { title: "Email Campaigns" };

export default async function Page() {
  await requireScreen("email-campaigns");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, product, status, audience_size, scheduled_at, started_at, created_at, paused_reason")
    .eq("channel", "email")
    .order("created_at", { ascending: false })
    .limit(200);
  const ids = (data ?? []).map((c) => c.id);
  const { data: counts } = ids.length ? await supabase.rpc("campaign_counts", { p_ids: ids }) : { data: [] };
  const byId = new Map(((counts ?? []) as (Counts & { campaign_id: string })[]).map((c) => [c.campaign_id, c]));
  const rows: CampaignListRow[] = (data ?? []).map((c) => {
    const n = byId.get(c.id);
    const counts = Object.fromEntries(Object.keys(ZERO_COUNTS).map((k) => [k, Number(n?.[k as keyof Counts] ?? 0)])) as Counts;
    return { ...(c as Omit<CampaignListRow, "counts">), counts };
  });
  return <CampaignList rows={rows} loadError={error ? "Could not load campaigns. Try again." : null} />;
}
