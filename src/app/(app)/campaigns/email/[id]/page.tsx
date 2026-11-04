import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readEmailLimits } from "@/lib/email/limits";
import { CampaignEditor, type EditorCampaign } from "./campaign-editor";
import { CampaignDetail, type DetailCampaign, type RecipientRow } from "./campaign-detail";
import { ZERO_COUNTS, type Counts } from "../status";

export const metadata: Metadata = { title: "Email campaign" };

const RECIPIENT_FILTERS = ["all", "pending", "sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed", "failed", "skipped"] as const;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const user = await requireScreen("email-campaigns");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const { data: limitsRow } = await admin.from("settings").select("value").eq("key", "email.limits").maybeSingle();
  const limits = readEmailLimits(limitsRow?.value);

  let campaign: (EditorCampaign & DetailCampaign) | null = null;
  if (id !== "new") {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, product, status, audience, audience_size, template_id, language, sender_id, sender_name, daily_limit, send_window_start, send_window_end, gap_seconds, follow_up_after_days, max_follow_ups, bounce_limit_pct, complaint_limit_pct, recent_contact_days, scheduled_at, started_at, finished_at, paused_reason, subject_snapshot, created_at")
      .eq("id", id)
      .eq("channel", "email")
      .maybeSingle();
    if (!data) notFound();
    campaign = data as unknown as EditorCampaign & DetailCampaign;
  }

  const { data: countRows } = campaign ? await supabase.rpc("campaign_counts", { p_ids: [campaign.id] }) : { data: [] };
  const raw = ((countRows ?? []) as Counts[])[0];
  const counts = Object.fromEntries(Object.keys(ZERO_COUNTS).map((k) => [k, Number(raw?.[k as keyof Counts] ?? 0)])) as Counts;

  if (!campaign || campaign.status === "draft") {
    const [{ data: templates }, { data: senders }, { data: views }, { data: skipped }] = await Promise.all([
      supabase.from("templates").select("id, name, product, language").eq("channel", "email").is("archived_at", null).order("name"),
      supabase.from("email_senders").select("id, from_name, from_email, is_active").order("from_email"),
      supabase.from("saved_views").select("id, name, is_shared, user_id").eq("screen", "leads").order("name"),
      campaign ? supabase.from("campaign_recipients").select("error").eq("campaign_id", campaign.id).eq("status", "skipped").limit(10000) : Promise.resolve({ data: [] as { error: string | null }[] }),
    ]);
    const reasons: Record<string, number> = {};
    for (const r of skipped ?? []) reasons[r.error ?? "Skipped"] = (reasons[r.error ?? "Skipped"] ?? 0) + 1;
    return (
      <CampaignEditor
        campaign={campaign}
        limits={limits}
        templates={(templates ?? []) as { id: string; name: string; product: EditorCampaign["product"]; language: "en" | "ur" }[]}
        senders={senders ?? []}
        views={(views ?? []).map((v) => ({ id: v.id, name: v.name, mine: v.user_id === user.id }))}
        built={campaign ? { added: counts.pending, skipped: counts.skipped, reasons } : null}
      />
    );
  }

  const filter = (RECIPIENT_FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof RECIPIENT_FILTERS)[number]) : "all";
  const page = Math.max(0, Math.min(10000, Number(sp.page) || 0));
  const size = 50;
  let q = supabase.from("campaign_recipients").select("id, lead_id, address, status, sent_at, delivered_at, opened_at, clicked_at, bounced_at, error, lead:leads(name, city)", { count: "exact" }).eq("campaign_id", campaign.id);
  if (filter === "sent") q = q.not("sent_at", "is", null);
  else if (filter === "delivered") q = q.not("delivered_at", "is", null);
  else if (filter === "opened") q = q.not("opened_at", "is", null);
  else if (filter === "clicked") q = q.not("clicked_at", "is", null);
  else if (filter === "bounced") q = q.not("bounced_at", "is", null);
  else if (filter === "pending") q = q.in("status", ["pending", "queued"]);
  else if (filter !== "all") q = q.eq("status", filter);
  const { data: recRows, count } = await q.order("created_at").order("id").range(page * size, page * size + size - 1);
  const recipients: RecipientRow[] = ((recRows ?? []) as unknown as (Omit<RecipientRow, "leadName" | "city"> & { lead: { name: string; city: string | null } | null })[]).map(({ lead, ...r }) => ({ ...r, leadName: lead?.name ?? "Deleted lead", city: lead?.city ?? null }));

  const [{ data: template }, { data: sender }] = await Promise.all([
    campaign.template_id ? supabase.from("templates").select("name").eq("id", campaign.template_id).maybeSingle() : Promise.resolve({ data: null }),
    campaign.sender_id ? supabase.from("email_senders").select("from_name, from_email").eq("id", campaign.sender_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return (
    <CampaignDetail
      campaign={campaign}
      counts={counts}
      recipients={recipients}
      total={count ?? 0}
      page={page}
      size={size}
      filter={filter}
      templateName={(template as { name: string } | null)?.name ?? null}
      sender={(sender as { from_name: string; from_email: string } | null) ?? null}
      limits={limits}
    />
  );
}
