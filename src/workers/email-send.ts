/**
 * email-send worker (SRS 8.3): sends one email through Resend, keeping the daily limit, sending
 * hours, gap and warm-up (via the dispatcher), and checking do-not-contact at the moment of sending.
 * Safe to run twice: the job claims its row first, and Resend's idempotency key stops a second send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { UnrecoverableError } from "bullmq";
import { checkEmailAllowance } from "@/lib/engine/budget";
import type { EmailJob } from "@/lib/engine/queue";
import { buildEmail, htmlToText, type TemplateLanguage } from "@/lib/email/render";
import { formatFrom, ResendError, sendWithResend } from "@/lib/email/resend";
import { makeUnsubscribeToken, unsubscribeUrls } from "@/lib/email/unsubscribe";
import { emailSettings, leadValues } from "@/lib/email/values";
import { inSendWindow, pkClock, planBatch, readEmailLimits, warmupLimit } from "@/lib/email/limits";
import type { Product } from "@/components/ui/chips";

export type EmailJobLike = { id?: string; data: EmailJob; attemptsMade: number; opts?: { attempts?: number } };
export type EmailDeps = {
  db: SupabaseClient;
  getApiKey: () => Promise<string | null>;
  encryptionKey: Buffer;
  appUrl: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  now?: () => Date;
};

type Sender = { id: string; from_name: string; from_email: string; reply_to: string | null; is_active: boolean; warmup_started_on: string | null; domain: string };

export async function processEmailJob(job: EmailJobLike, deps: EmailDeps): Promise<string> {
  return "recipientId" in job.data ? sendCampaignEmail(job, job.data.recipientId, deps) : sendOneOff(job, job.data.messageId, deps);
}

async function sendCampaignEmail(job: EmailJobLike, recipientId: string, deps: EmailDeps): Promise<string> {
  const { db } = deps;
  const jobId = String(job.id);
  const { data: r } = await db
    .from("campaign_recipients")
    .update({ job_id: jobId })
    .eq("id", recipientId)
    .eq("status", "queued")
    .or(`job_id.is.null,job_id.eq.${jobId}`)
    .select("id, campaign_id, lead_id, contact_id, address")
    .maybeSingle();
  if (!r) return "skipped: not queued";

  const release = () =>
    db.from("campaign_recipients").update({ status: "pending", queued_at: null, job_id: null }).eq("id", r.id).eq("job_id", jobId);
  const skip = async (reason: string) => {
    await db.from("campaign_recipients").update({ status: "skipped", error: reason, job_id: null }).eq("id", r.id).eq("job_id", jobId);
    return `skipped: ${reason}`;
  };
  const fail = (reason: string) =>
    db.from("campaign_recipients").update({ status: "failed", failed_at: new Date().toISOString(), error: reason, job_id: null }).eq("id", r.id).eq("job_id", jobId);

  const { data: c } = await db
    .from("campaigns")
    .select("id, status, product, language, subject_snapshot, body_snapshot, sender_id, sender_name")
    .eq("id", r.campaign_id)
    .maybeSingle();
  if (!c || c.status !== "sending") {
    await release();
    return "released: campaign not sending";
  }

  // Checked at the moment of sending (SRS 8.4), not only when the audience was built.
  const { data: blocked } = await db.rpc("is_do_not_contact", { p_channel: "email", p_value: r.address });
  if (blocked) return skip("On the do-not-contact list");
  if (r.contact_id) {
    const { data: contact } = await db.from("lead_contacts").select("consent_state, verification").eq("id", r.contact_id).maybeSingle();
    if (contact?.consent_state === "opted_out") return skip("Opted out");
    if (contact && contact.verification !== "valid") return skip("Email no longer verified");
  }

  const allowance = await checkEmailAllowance(db, c.product as Product, 0, deps.now?.());
  if (!allowance.ok || (allowance.cap !== null && allowance.used > allowance.cap)) {
    await release();
    await pauseCampaign(db, c.id, allowance.message ?? "The Resend plan cap is used up for this period.");
    return "paused: cap or budget";
  }

  const sender = await loadSender(db, c.sender_id);
  if (!sender?.is_active) {
    await release();
    await pauseCampaign(db, c.id, "The campaign's sender address is missing or turned off in Settings.");
    return "paused: sender";
  }
  const apiKey = await deps.getApiKey();
  if (!apiKey) {
    await release();
    await pauseCampaign(db, c.id, "The Resend API key is not set in Settings.");
    return "paused: no key";
  }
  if (!deps.appUrl) {
    await release();
    await pauseCampaign(db, c.id, "APP_URL is not set for the workers, so unsubscribe links cannot be made.");
    return "paused: no app url";
  }
  if (!c.subject_snapshot || !c.body_snapshot) return skip("The campaign has no email content");

  const { data: lead } = await db.from("leads").select("name, city, product").eq("id", r.lead_id).maybeSingle();
  if (!lead) return skip("Lead was deleted");
  const settings = await emailSettings(db);
  const fromName = (c.sender_name as string | null)?.trim() || sender.from_name;
  const token = makeUnsubscribeToken({ kind: "r", id: r.id }, deps.encryptionKey);
  const urls = unsubscribeUrls(deps.appUrl, token);
  const email = buildEmail({
    subject: c.subject_snapshot,
    bodyHtml: c.body_snapshot,
    values: leadValues(lead as { name: string; city: string | null; product: Product }, settings.priceLines, fromName),
    language: (c.language ?? "en") as TemplateLanguage,
    footer: settings.footer,
    unsubscribeUrl: urls.page,
  });

  let sent: { id: string };
  try {
    sent = await sendWithResend(
      apiKey,
      {
        from: formatFrom(fromName, sender.from_email),
        to: r.address,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: sender.reply_to,
        headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: [{ name: "campaign_id", value: c.id }],
      },
      `prospector-r-${r.id}`,
      deps.fetchImpl,
    );
  } catch (e) {
    const err = e instanceof ResendError ? e : new ResendError("Resend could not send the email.", false);
    if (err.pause) {
      await release();
      await pauseCampaign(db, c.id, err.message);
      return "paused: provider";
    }
    if (err.fatal || job.attemptsMade + 1 >= (job.opts?.attempts ?? 3)) {
      await fail(err.message);
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }

  await recordSent(db, { recipient: r.id, message: null, jobId, providerId: sent.id, from: sender.from_email, subject: email.subject, body: htmlToText(email.html.replace(/<hr[\s\S]*$/, "")), now: deps.now?.() });
  await startWarmup(db, sender, deps.now?.());
  deps.log?.("email sent", { recipientId: r.id, campaignId: c.id });
  return "sent";
}

async function sendOneOff(job: EmailJobLike, messageId: string, deps: EmailDeps): Promise<string> {
  const { db } = deps;
  const jobId = String(job.id);
  const { data: m } = await db
    .from("messages")
    .update({ job_id: jobId })
    .eq("id", messageId)
    .eq("status", "queued")
    .eq("channel", "email")
    .eq("direction", "outbound")
    .or(`job_id.is.null,job_id.eq.${jobId}`)
    .select("id, lead_id, to_address, subject, body, sender_id, language")
    .maybeSingle();
  if (!m) return "skipped: not queued";
  const fail = async (reason: string) => {
    await db.from("messages").update({ status: "failed", error: reason, job_id: null }).eq("id", m.id).eq("job_id", jobId);
    return `failed: ${reason}`;
  };

  const { data: blocked } = await db.rpc("is_do_not_contact", { p_channel: "email", p_value: m.to_address });
  if (blocked) return fail("The address is on the do-not-contact list.");
  const { data: contact } = await db
    .from("lead_contacts")
    .select("consent_state, verification")
    .eq("lead_id", m.lead_id)
    .eq("kind", "email")
    .eq("value_normalized", String(m.to_address).trim().toLowerCase())
    .maybeSingle();
  if (contact?.consent_state === "opted_out") return fail("The contact has opted out.");
  if (contact?.verification === "invalid") return fail("The address is invalid.");

  const { data: lead } = await db.from("leads").select("name, city, product").eq("id", m.lead_id).maybeSingle();
  const allowance = await checkEmailAllowance(db, (lead?.product ?? null) as Product | null, 0, deps.now?.());
  if (!allowance.ok || (allowance.cap !== null && allowance.used > allowance.cap)) return fail(allowance.message ?? "The Resend plan cap is used up.");
  const sender = await loadSender(db, m.sender_id);
  if (!sender?.is_active) return fail("The sender address is missing or turned off in Settings.");
  const apiKey = await deps.getApiKey();
  if (!apiKey) return fail("The Resend API key is not set in Settings.");
  if (!deps.appUrl) return fail("APP_URL is not set for the workers, so the unsubscribe link cannot be made.");

  const settings = await emailSettings(db);
  const token = makeUnsubscribeToken({ kind: "m", id: m.id }, deps.encryptionKey);
  const urls = unsubscribeUrls(deps.appUrl, token);
  const email = buildEmail({
    subject: m.subject ?? "",
    bodyHtml: m.body ?? "",
    values: lead ? leadValues(lead as { name: string; city: string | null; product: Product }, settings.priceLines, sender.from_name) : {},
    language: (m.language ?? "en") as TemplateLanguage,
    footer: settings.footer,
    unsubscribeUrl: urls.page,
  });
  let sent: { id: string };
  try {
    sent = await sendWithResend(
      apiKey,
      {
        from: formatFrom(sender.from_name, sender.from_email),
        to: m.to_address,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: sender.reply_to,
        headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      },
      `prospector-m-${m.id}`,
      deps.fetchImpl,
    );
  } catch (e) {
    const err = e instanceof ResendError ? e : new ResendError("Resend could not send the email.", false);
    if (err.fatal || err.pause || job.attemptsMade + 1 >= (job.opts?.attempts ?? 3)) {
      await fail(err.message);
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
  await recordSent(db, { recipient: null, message: m.id, jobId, providerId: sent.id, from: sender.from_email, subject: email.subject, body: htmlToText(email.html.replace(/<hr[\s\S]*$/, "")), now: deps.now?.() });
  await startWarmup(db, sender, deps.now?.());
  return "sent";
}

async function loadSender(db: SupabaseClient, id: string | null): Promise<Sender | null> {
  if (!id) return null;
  const { data } = await db.from("email_senders").select("id, from_name, from_email, reply_to, is_active, warmup_started_on, domain").eq("id", id).maybeSingle();
  return (data as Sender | null) ?? null;
}

async function recordSent(
  db: SupabaseClient,
  a: { recipient: string | null; message: string | null; jobId: string; providerId: string; from: string; subject: string; body: string; now?: Date },
) {
  const allowance = await checkEmailAllowance(db, null, 0, a.now);
  const { error } = await db.rpc("record_email_sent", {
    p_recipient: a.recipient,
    p_message: a.message,
    p_job: a.jobId,
    p_provider_id: a.providerId,
    p_from: a.from,
    p_subject: a.subject,
    p_body: a.body,
    p_period_start: allowance.period.start,
    p_period_end: allowance.period.end,
  });
  // The email has gone; a failed record must not send it again, so this is logged, not retried.
  if (error) throw new UnrecoverableError(`The email was sent but could not be recorded: ${error.message}`);
}

async function startWarmup(db: SupabaseClient, sender: Sender, now = new Date()) {
  if (sender.warmup_started_on) return;
  await db.from("email_senders").update({ warmup_started_on: pkClock(now).date }).eq("id", sender.id).is("warmup_started_on", null);
}

export async function pauseCampaign(db: SupabaseClient, id: string, reason: string) {
  const { data } = await db.from("campaigns").update({ status: "paused", paused_reason: reason }).eq("id", id).eq("status", "sending").select("id");
  if (data?.length) {
    await db.from("audit_log").insert({ action: "campaign.auto_paused", entity_type: "campaign", entity_id: id, details: { reason } });
  }
}

type SendingCampaign = {
  id: string;
  product: Product;
  daily_limit: number | null;
  send_window_start: string | null;
  send_window_end: string | null;
  gap_seconds: number | null;
  next_send_at: string | null;
  sender_id: string | null;
};

export const DISPATCH_TICK_SECONDS = 15;

/**
 * Every tick: starts scheduled campaigns that are due, finishes campaigns with nothing left, and hands
 * each sending campaign the emails it may send before the next tick.
 */
export async function dispatchEmailCampaigns(
  db: SupabaseClient,
  enqueue: (rows: { id: string; queuedAt: string; delayMs: number }[]) => Promise<void>,
  now = new Date(),
): Promise<number> {
  await db
    .from("campaigns")
    .update({ status: "sending", started_at: now.toISOString() })
    .eq("channel", "email")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString());

  const { data } = await db
    .from("campaigns")
    .select("id, product, daily_limit, send_window_start, send_window_end, gap_seconds, next_send_at, sender_id")
    .eq("channel", "email")
    .eq("status", "sending")
    .order("started_at");
  const campaigns = (data ?? []) as SendingCampaign[];
  if (campaigns.length === 0) return 0;

  const settings = await emailSettings(db);
  const limits = readEmailLimits(settings.limits);
  const clock = pkClock(now);
  const allowance = await checkEmailAllowance(db, null, 0, now);
  if (!allowance.ok) {
    for (const c of campaigns) await pauseCampaign(db, c.id, allowance.message ?? "Emails are blocked by the cost settings.");
    return 0;
  }
  let capLeft = Math.max(0, (allowance.cap ?? 0) - allowance.used);
  let total = 0;

  for (const c of campaigns) {
    const { data: s } = await db.rpc("email_send_stats", { p_campaign: c.id, p_day_start: clock.dayStart.toISOString() });
    const stats = s as { campaign_today: number; domain_today: number; total_today: number; remaining: number; pending: number };
    if (Number(stats.remaining) === 0) {
      await db.from("campaigns").update({ status: "done", finished_at: now.toISOString() }).eq("id", c.id).eq("status", "sending");
      continue;
    }
    if (Number(stats.pending) === 0) continue;
    if (!inSendWindow(now, (c.send_window_start ?? limits.window_start).slice(0, 5), (c.send_window_end ?? limits.window_end).slice(0, 5))) continue;
    if (capLeft === 0) {
      await pauseCampaign(db, c.id, `The Resend plan cap is used up for this period (until ${allowance.period.end}).`);
      continue;
    }
    const sender = await loadSender(db, c.sender_id);
    if (!sender?.is_active) {
      await pauseCampaign(db, c.id, "The campaign's sender address is missing or turned off in Settings.");
      continue;
    }
    const allowed = Math.min(
      (c.daily_limit ?? Infinity) - Number(stats.campaign_today),
      limits.daily_cap - Number(stats.total_today),
      warmupLimit(limits.warmup, sender.warmup_started_on, clock.date) - Number(stats.domain_today),
      capLeft,
    );
    const gap = c.gap_seconds ?? limits.gap_seconds;
    const batch = planBatch({ now, nextSendAt: c.next_send_at ? new Date(c.next_send_at) : null, gapSeconds: gap, tickSeconds: DISPATCH_TICK_SECONDS, allowed });
    if (batch.count === 0) continue;

    const { data: claimed, error } = await db.rpc("claim_email_recipients", { p_campaign: c.id, p_limit: batch.count });
    if (error) throw new Error(`Could not claim emails to send: ${error.message}`);
    const rows = ((claimed ?? []) as { id: string; queued_at: string }[]).map((x, i) => ({
      id: x.id,
      queuedAt: x.queued_at,
      delayMs: batch.firstAt.getTime() - now.getTime() + i * gap * 1000,
    }));
    if (rows.length === 0) continue;
    try {
      await enqueue(rows);
    } catch (e) {
      await db.from("campaign_recipients").update({ status: "pending", queued_at: null }).in("id", rows.map((x) => x.id)).eq("status", "queued");
      throw e;
    }
    await db.from("campaigns").update({ next_send_at: new Date(batch.firstAt.getTime() + rows.length * gap * 1000).toISOString() }).eq("id", c.id);
    capLeft -= rows.length;
    total += rows.length;
  }
  return total;
}
