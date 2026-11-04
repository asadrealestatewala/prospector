"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { checkEmailAllowance } from "@/lib/engine/budget";
import { applyLeadFilters, leadFilterSchema } from "@/lib/leads/filters";
import { sendTestEmail } from "@/lib/email/server";
import type { Product } from "@/components/ui/chips";

export type CampaignResult = { ok: true; message: string; id?: string; summary?: AudienceSummary } | { ok: false; error: string };
export type AudienceSummary = { leads: number; added: number; skipped: number; noEmail: number; reasons: Record<string, number> };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e && typeof e === "object" && "message" in e && "code" in e) {
    const pg = e as { code: string; message: string };
    if (pg.code === "22023" || pg.code === "P0002") return { ok: false, error: pg.message };
    if (pg.code === "42501") return { ok: false, error: "You do not have access to this action." };
  }
  console.error("campaign action failed", e instanceof Error ? e.message : e);
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

const PRODUCTS = ["classwell", "vetlin", "postwala"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM for sending hours, for example 09:00.");
const optInt = (min: number, max: number, msg: string) =>
  z.union([z.literal(""), z.null(), z.coerce.number().int(msg).min(min, msg).max(max, msg)]).transform((v) => (v === "" || v === null ? null : v));

const draftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Enter a campaign name of at least 2 characters.").max(120),
  product: z.enum(PRODUCTS),
  audience: z.union([
    z.object({ type: z.literal("view"), viewId: z.string().uuid() }),
    z.object({ type: z.literal("leads"), ids: z.array(z.string().uuid()).max(10000) }),
    z.object({ type: z.literal("none") }),
  ]),
  templateId: z.string().uuid().nullable(),
  senderId: z.string().uuid().nullable(),
  senderName: z.string().trim().max(80).nullable(),
  dailyLimit: optInt(1, 100000, "Daily limit must be a whole number from 1 to 100,000."),
  windowStart: time,
  windowEnd: time,
  gapSeconds: z.coerce.number().int().min(0, "The gap cannot be negative.").max(3600, "Keep the gap under one hour."),
  followUpDays: optInt(1, 60, "Follow-up days must be from 1 to 60."),
  maxFollowUps: z.coerce.number().int().min(0).max(3, "At most three follow-ups."),
  bounceLimitPct: z.coerce.number().min(0.1).max(100),
  complaintLimitPct: z.coerce.number().min(0.01).max(100),
  recentContactDays: z.coerce.number().int().min(0).max(365),
});
export type CampaignDraft = z.input<typeof draftSchema>;

export async function saveEmailCampaign(input: CampaignDraft): Promise<CampaignResult> {
  try {
    const actor = await requireRole("admin", "manager");
    const v = draftSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    let sending_domain: string | null = null;
    let from_address: string | null = null;
    if (v.senderId) {
      const { data: s } = await supabase.from("email_senders").select("from_email, domain").eq("id", v.senderId).maybeSingle();
      sending_domain = s?.domain ?? null;
      from_address = s?.from_email ?? null;
    }
    let language: "en" | "ur" = "en";
    if (v.templateId) {
      const { data: t } = await supabase.from("templates").select("language, product").eq("id", v.templateId).maybeSingle();
      if (t && t.product !== v.product) return { ok: false, error: "The template is for another product. Pick a template for this campaign's product." };
      language = (t?.language as "en" | "ur") ?? "en";
    }
    const audience = v.audience.type === "view" ? { type: "view", view_id: v.audience.viewId } : v.audience.type === "leads" ? { type: "leads", ids: v.audience.ids } : {};
    const row = {
      name: v.name,
      product: v.product,
      audience,
      template_id: v.templateId,
      language,
      sender_id: v.senderId,
      sender_name: v.senderName || null,
      sending_domain,
      from_address,
      daily_limit: v.dailyLimit,
      send_window_start: v.windowStart,
      send_window_end: v.windowEnd,
      gap_seconds: v.gapSeconds,
      follow_up_after_days: v.maxFollowUps > 0 ? (v.followUpDays ?? 3) : v.followUpDays,
      max_follow_ups: v.maxFollowUps,
      bounce_limit_pct: v.bounceLimitPct,
      complaint_limit_pct: v.complaintLimitPct,
      recent_contact_days: v.recentContactDays,
    };
    if (v.id) {
      const { data, error } = await supabase.from("campaigns").update(row).eq("id", v.id).eq("status", "draft").select("id");
      if (error) throw error;
      if (!data?.length) return { ok: false, error: "Only a draft campaign can be edited." };
      revalidatePath(`/campaigns/email/${v.id}`);
      return { ok: true, message: "Draft saved.", id: v.id };
    }
    const { data, error } = await supabase.from("campaigns").insert({ ...row, channel: "email", created_by: actor.id }).select("id").single();
    if (error) throw error;
    await writeAudit(actor, "campaign.created", "campaign", data.id, { name: v.name, channel: "email" });
    revalidatePath("/campaigns/email");
    return { ok: true, message: "Draft saved.", id: data.id };
  } catch (e) {
    return fail(e);
  }
}

/** Leads screen bulk action: a new draft with the selected leads as its audience. */
export async function createCampaignFromLeads(leadIds: string[]): Promise<CampaignResult> {
  try {
    const actor = await requireRole("admin", "manager");
    const ids = z.array(z.string().uuid()).min(1, "Select at least one lead.").max(10000, "Select at most 10,000 leads.").parse(leadIds);
    const supabase = await createSupabaseServerClient();
    const { data: leads, error } = await supabase.from("leads").select("product").in("id", ids.slice(0, 1000));
    if (error) throw error;
    const products = [...new Set((leads ?? []).map((l) => l.product as Product))];
    if (products.length > 1) return { ok: false, error: "The selected leads belong to more than one product. A campaign is for one product; filter by product first." };
    const product = products[0] ?? "classwell";
    const { data: limitsRow } = await createSupabaseAdminClient().from("settings").select("value").eq("key", "email.limits").maybeSingle();
    const l = (limitsRow?.value ?? {}) as Record<string, unknown>;
    const { data, error: insErr } = await supabase
      .from("campaigns")
      .insert({
        channel: "email",
        name: `Email to ${ids.length.toLocaleString("en-PK")} selected leads`,
        product,
        audience: { type: "leads", ids },
        send_window_start: (l.window_start as string) ?? "09:00",
        send_window_end: (l.window_end as string) ?? "18:00",
        gap_seconds: Number(l.gap_seconds ?? 60),
        bounce_limit_pct: Number(l.bounce_limit_pct ?? 5),
        complaint_limit_pct: Number(l.complaint_limit_pct ?? 0.3),
        recent_contact_days: Number(l.recent_contact_days ?? 30),
        created_by: actor.id,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    await writeAudit(actor, "campaign.created", "campaign", data.id, { channel: "email", from: "leads", leads: ids.length });
    return { ok: true, message: "Draft campaign created.", id: data.id };
  } catch (e) {
    return fail(e);
  }
}

/** Lead ids for a saved view, limited to the campaign's product. */
async function viewLeadIds(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, viewId: string, product: Product): Promise<string[] | { error: string }> {
  const { data: view } = await supabase.from("saved_views").select("params").eq("id", viewId).maybeSingle();
  if (!view) return { error: "The saved view was not found. It may have been deleted or is not shared with you." };
  const filters = leadFilterSchema.parse({ ...(view.params as object), product });
  const ids: string[] = [];
  for (let page = 0; page < 10; page++) {
    let q = supabase.from("leads").select(filters.consent ? "id, lead_contacts!inner(consent_state)" : "id");
    q = applyLeadFilters(q, filters);
    const { data, error } = await q.order("id").range(page * 1000, page * 1000 + 999);
    if (error) return { error: "Could not read the leads in this view." };
    const rows = (data ?? []) as unknown as { id: string }[];
    ids.push(...rows.map((r) => r.id));
    if (rows.length < 1000) break;
  }
  return [...new Set(ids)];
}

/** Builds (or rebuilds) the recipient list of a draft and explains every skipped lead. */
export async function buildCampaignAudience(id: string): Promise<CampaignResult> {
  try {
    const actor = await requireRole("admin", "manager");
    z.string().uuid().parse(id);
    const supabase = await createSupabaseServerClient();
    const { data: c } = await supabase.from("campaigns").select("id, status, product, audience").eq("id", id).eq("channel", "email").maybeSingle();
    if (!c) return { ok: false, error: "Campaign not found." };
    if (c.status !== "draft") return { ok: false, error: "Only a draft campaign can change its audience." };
    const a = (c.audience ?? {}) as { type?: string; view_id?: string; ids?: string[] };
    let ids: string[];
    if (a.type === "view" && a.view_id) {
      const r = await viewLeadIds(supabase, a.view_id, c.product as Product);
      if (!Array.isArray(r)) return { ok: false, error: r.error };
      ids = r;
    } else if (a.type === "leads" && Array.isArray(a.ids)) {
      ids = a.ids;
    } else {
      return { ok: false, error: "Choose the audience first: a saved view or leads selected on the Leads screen." };
    }
    if (ids.length === 0) return { ok: false, error: "No leads match this audience." };
    if (ids.length > 10000) return { ok: false, error: "This audience has more than 10,000 leads. Narrow the saved view, or split it into more campaigns." };

    const { error: delErr } = await supabase.from("campaign_recipients").delete().eq("campaign_id", id);
    if (delErr) throw delErr;
    const summary: AudienceSummary = { leads: ids.length, added: 0, skipped: 0, noEmail: 0, reasons: {} };
    for (let i = 0; i < ids.length; i += 2000) {
      const { data, error } = await supabase.rpc("build_campaign_audience", { p_campaign: id, p_lead_ids: ids.slice(i, i + 2000) });
      if (error) throw error;
      const r = data as { added: number; skipped: number; no_email: number; reasons: Record<string, number> };
      summary.added += Number(r.added);
      summary.skipped += Number(r.skipped);
      summary.noEmail += Number(r.no_email);
      for (const [k, n] of Object.entries(r.reasons ?? {})) summary.reasons[k] = (summary.reasons[k] ?? 0) + Number(n);
    }
    await writeAudit(actor, "campaign.audience_built", "campaign", id, { leads: summary.leads, added: summary.added, skipped: summary.skipped });
    revalidatePath(`/campaigns/email/${id}`);
    return { ok: true, message: `${summary.added.toLocaleString("en-PK")} leads will get this email.`, summary };
  } catch (e) {
    return fail(e);
  }
}

/** Starts now or at a Pakistan date and time, after every safeguard and the cap and budget check. */
export async function scheduleEmailCampaign(id: string, when: string | null): Promise<CampaignResult> {
  try {
    const actor = await requireRole("admin", "manager");
    z.string().uuid().parse(id);
    let scheduledAt = new Date();
    if (when) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return { ok: false, error: "Enter the start date and time." };
      scheduledAt = new Date(`${when}:00+05:00`);
      if (scheduledAt.getTime() < Date.now() - 60_000) return { ok: false, error: "The start time is in the past. Pick a later time or send now." };
    }
    const supabase = await createSupabaseServerClient();
    const { data: c } = await supabase
      .from("campaigns")
      .select("id, name, status, product, audience_size, template_id, sender_id, send_window_start, send_window_end")
      .eq("id", id)
      .eq("channel", "email")
      .maybeSingle();
    if (!c) return { ok: false, error: "Campaign not found." };
    if (c.status !== "draft") return { ok: false, error: "This campaign is already scheduled or sending." };
    if (!c.template_id) return { ok: false, error: "Choose a template." };
    if (!c.sender_id) return { ok: false, error: "Choose the sender address." };
    if (!c.audience_size) return { ok: false, error: "The audience has no one to email. Build the audience and check the skipped reasons." };

    const { data: t } = await supabase.from("templates").select("subject, body, language, archived_at, product").eq("id", c.template_id).maybeSingle();
    if (!t || t.archived_at) return { ok: false, error: "The template is archived or missing. Pick another one." };
    if (t.product !== c.product) return { ok: false, error: "The template is for another product." };
    const { data: s } = await supabase.from("email_senders").select("is_active").eq("id", c.sender_id).maybeSingle();
    if (!s?.is_active) return { ok: false, error: "The sender address is turned off. Pick another one in the campaign." };

    const admin = createSupabaseAdminClient();
    const { data: keyRow } = await admin.from("settings").select("secret_last4").eq("key", "resend.api_key").maybeSingle();
    if (!keyRow?.secret_last4) return { ok: false, error: "The Resend API key is not set. An Admin adds it in Settings, Integrations." };
    // SRS 8.4: check the remaining plan cap and budget before queuing.
    const allowance = await checkEmailAllowance(admin, c.product as Product, Number(c.audience_size));
    if (!allowance.ok) return { ok: false, error: allowance.message ?? "Emails are blocked by the cost settings." };

    const { data, error } = await supabase
      .from("campaigns")
      .update({
        status: "scheduled",
        scheduled_at: scheduledAt.toISOString(),
        subject_snapshot: t.subject,
        body_snapshot: t.body,
        language: t.language,
        approved_by: actor.id,
        approved_at: new Date().toISOString(),
        paused_reason: null,
        next_send_at: null,
      })
      .eq("id", id)
      .eq("status", "draft")
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, error: "This campaign is already scheduled or sending." };
    await writeAudit(actor, "campaign.scheduled", "campaign", id, { recipients: c.audience_size, at: scheduledAt.toISOString() });
    revalidatePath("/campaigns/email");
    revalidatePath(`/campaigns/email/${id}`);
    const msg = when ? `Scheduled. Sending starts ${when.replace("T", " at ")} Pakistan time.` : "Campaign started. Emails go out within the sending hours.";
    return { ok: true, message: [msg, allowance.warning].filter(Boolean).join(" ") };
  } catch (e) {
    return fail(e);
  }
}

export async function setEmailCampaignState(id: string, action: "pause" | "resume" | "stop"): Promise<CampaignResult> {
  try {
    const actor = await requireRole("admin", "manager");
    z.string().uuid().parse(id);
    const supabase = await createSupabaseServerClient();
    const { data: c } = await supabase.from("campaigns").select("id, status, product").eq("id", id).eq("channel", "email").maybeSingle();
    if (!c) return { ok: false, error: "Campaign not found." };
    let patch: Record<string, unknown>;
    let from: string[];
    if (action === "pause") {
      from = ["sending", "scheduled"];
      patch = { status: "paused", paused_reason: "Paused by a user." };
    } else if (action === "resume") {
      from = ["paused"];
      const admin = createSupabaseAdminClient();
      const { count } = await supabase.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "pending");
      const allowance = await checkEmailAllowance(admin, c.product as Product, Math.min(Number(count ?? 0), 1));
      if (!allowance.ok) return { ok: false, error: allowance.message ?? "Emails are blocked by the cost settings." };
      patch = { status: "sending", paused_reason: null, next_send_at: null };
    } else {
      from = ["sending", "scheduled", "paused", "draft"];
      patch = { status: "stopped", finished_at: new Date().toISOString(), paused_reason: null };
    }
    const { data, error } = await supabase.from("campaigns").update(patch).eq("id", id).in("status", from).select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, error: "The campaign has changed. Refresh the page." };
    if (action === "stop") {
      await supabase.from("campaign_recipients").update({ status: "skipped", error: "Campaign stopped" }).eq("campaign_id", id).eq("status", "pending");
    }
    await writeAudit(actor, `campaign.${action === "stop" ? "stopped" : action === "pause" ? "paused" : "resumed"}`, "campaign", id);
    revalidatePath("/campaigns/email");
    revalidatePath(`/campaigns/email/${id}`);
    return {
      ok: true,
      message: action === "pause" ? "Campaign paused. Emails already handed to Resend may still go out." : action === "resume" ? "Campaign resumed." : "Campaign stopped. No more emails will be sent.",
    };
  } catch (e) {
    return fail(e);
  }
}

/** "A test email to yourself" before sending (SRS screen 7 safeguards). */
export async function sendCampaignTest(id: string): Promise<CampaignResult> {
  try {
    const actor = await requireRole("admin", "manager");
    const supabase = await createSupabaseServerClient();
    const { data: c } = await supabase.from("campaigns").select("product, template_id, sender_id, subject_snapshot, body_snapshot, language").eq("id", z.string().uuid().parse(id)).maybeSingle();
    if (!c?.sender_id) return { ok: false, error: "Choose the sender address and save the draft first." };
    let subject = c.subject_snapshot as string | null;
    let body = c.body_snapshot as string | null;
    let language = (c.language ?? "en") as "en" | "ur";
    if (!subject || !body) {
      if (!c.template_id) return { ok: false, error: "Choose a template and save the draft first." };
      const { data: t } = await supabase.from("templates").select("subject, body, language").eq("id", c.template_id).maybeSingle();
      subject = t?.subject ?? "";
      body = t?.body ?? "";
      language = (t?.language ?? "en") as "en" | "ur";
    }
    const r = await sendTestEmail({ to: actor.email, senderId: c.sender_id, subject: subject ?? "", body: body ?? "", product: c.product as Product, language });
    if (!r.ok) return r;
    await writeAudit(actor, "campaign.test_sent", "campaign", id);
    return { ok: true, message: `Test email sent to ${actor.email}.` };
  } catch (e) {
    return fail(e);
  }
}
