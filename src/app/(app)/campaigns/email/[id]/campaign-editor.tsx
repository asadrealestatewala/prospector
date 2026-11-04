"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Send, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Product } from "@/components/ui/chips";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { EmailLimits } from "@/lib/email/limits";
import { formatNumber } from "@/lib/utils";
import { buildCampaignAudience, saveEmailCampaign, scheduleEmailCampaign, sendCampaignTest, type CampaignDraft } from "../actions";

export type EditorCampaign = {
  id: string;
  name: string;
  product: Product;
  status: string;
  audience: { type?: string; view_id?: string; ids?: string[] } | null;
  audience_size: number;
  template_id: string | null;
  language: "en" | "ur";
  sender_id: string | null;
  sender_name: string | null;
  daily_limit: number | null;
  send_window_start: string | null;
  send_window_end: string | null;
  gap_seconds: number | null;
  follow_up_after_days: number | null;
  max_follow_ups: number;
  bounce_limit_pct: number | null;
  complaint_limit_pct: number | null;
  recent_contact_days: number;
};

type Built = { added: number; skipped: number; reasons: Record<string, number>; noEmail?: number; leads?: number };

/** SRS screen 7 create steps: name and product, audience, template, sender, sending controls, safeguards, schedule. */
export function CampaignEditor({
  campaign,
  limits,
  templates,
  senders,
  views,
  built: initialBuilt,
}: {
  campaign: EditorCampaign | null;
  limits: EmailLimits;
  templates: { id: string; name: string; product: Product; language: "en" | "ur" }[];
  senders: { id: string; from_name: string; from_email: string; is_active: boolean }[];
  views: { id: string; name: string; mine: boolean }[];
  built: Built | null;
}) {
  const router = useRouter();
  const selectedIds = campaign?.audience?.type === "leads" ? (campaign.audience.ids ?? []) : [];
  const [f, setF] = React.useState({
    name: campaign?.name ?? "",
    product: (campaign?.product ?? "classwell") as Product,
    audienceType: (campaign?.audience?.type === "leads" ? "leads" : "view") as "view" | "leads",
    viewId: campaign?.audience?.view_id ?? views[0]?.id ?? "",
    templateId: campaign?.template_id ?? "",
    senderId: campaign?.sender_id ?? senders.find((s) => s.is_active)?.id ?? "",
    senderName: campaign?.sender_name ?? "",
    dailyLimit: campaign?.daily_limit != null ? String(campaign.daily_limit) : "",
    windowStart: (campaign?.send_window_start ?? limits.window_start).slice(0, 5),
    windowEnd: (campaign?.send_window_end ?? limits.window_end).slice(0, 5),
    gapSeconds: String(campaign?.gap_seconds ?? limits.gap_seconds),
    maxFollowUps: String(campaign?.max_follow_ups ?? 0),
    followUpDays: campaign?.follow_up_after_days != null ? String(campaign.follow_up_after_days) : "3",
    bounceLimitPct: String(campaign?.bounce_limit_pct ?? limits.bounce_limit_pct),
    complaintLimitPct: String(campaign?.complaint_limit_pct ?? limits.complaint_limit_pct),
    recentContactDays: String(campaign ? campaign.recent_contact_days : limits.recent_contact_days),
  });
  const [built, setBuilt] = React.useState<Built | null>(initialBuilt && (initialBuilt.added || initialBuilt.skipped) ? initialBuilt : null);
  const [busy, setBusy] = React.useState<null | string>(null);
  const [whenMode, setWhenMode] = React.useState<"now" | "later">("now");
  const [when, setWhen] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  // The draft's id once saved, so a new campaign is created only once.
  const idRef = React.useRef<string | null>(campaign?.id ?? null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const productTemplates = templates.filter((t) => t.product === f.product);
  const template = templates.find((t) => t.id === f.templateId);

  function draft(): CampaignDraft {
    return {
      id: idRef.current ?? undefined,
      name: f.name,
      product: f.product,
      audience: f.audienceType === "leads" ? { type: "leads", ids: selectedIds } : f.viewId ? { type: "view", viewId: f.viewId } : { type: "none" },
      templateId: f.templateId || null,
      senderId: f.senderId || null,
      senderName: f.senderName || null,
      dailyLimit: f.dailyLimit,
      windowStart: f.windowStart,
      windowEnd: f.windowEnd,
      gapSeconds: f.gapSeconds,
      followUpDays: f.followUpDays,
      maxFollowUps: f.maxFollowUps,
      bounceLimitPct: f.bounceLimitPct,
      complaintLimitPct: f.complaintLimitPct,
      recentContactDays: f.recentContactDays,
    };
  }

  async function save(quiet = false): Promise<string | null> {
    if (f.name.trim().length < 2) {
      setNameError("Enter a campaign name of at least 2 characters.");
      return null;
    }
    setBusy((b) => b ?? "save");
    const r = await saveEmailCampaign(draft());
    setBusy((b) => (b === "save" ? null : b));
    if (!r.ok) {
      toast.error(r.error);
      return null;
    }
    if (!quiet) toast.success(r.message);
    if (!idRef.current && r.id) {
      idRef.current = r.id;
      router.replace(`/campaigns/email/${r.id}`);
    }
    return idRef.current;
  }

  async function build() {
    setBusy("build");
    const id = await save(true);
    if (!id) return setBusy(null);
    const r = await buildCampaignAudience(id);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setBuilt(r.summary ? { added: r.summary.added, skipped: r.summary.skipped, reasons: r.summary.reasons, noEmail: r.summary.noEmail, leads: r.summary.leads } : null);
    toast.success(r.message);
    router.refresh();
  }

  async function test() {
    setBusy("test");
    const id = await save(true);
    if (!id) return setBusy(null);
    const r = await sendCampaignTest(id);
    setBusy(null);
    if (r.ok) toast.success(r.message);
    else toast.error(r.error);
  }

  async function start() {
    setBusy("start");
    const id = await save(true);
    if (!id) return setBusy(null);
    const r = await scheduleEmailCampaign(id, whenMode === "later" ? when : null);
    setBusy(null);
    setConfirm(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    router.refresh();
  }

  const canStart = !!built?.added && !!f.templateId && !!f.senderId && (whenMode === "now" || !!when);

  return (
    <>
      <Link href="/campaigns/email" className="mb-3 inline-flex items-center gap-1 text-helper text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Email Campaigns
      </Link>
      <PageHeader
        title={campaign ? campaign.name : "New email campaign"}
        description="Drafts are saved here until you start or schedule them."
        actions={<Button loading={busy === "save"} onClick={() => save()}>Save draft</Button>}
      />
      <div className="flex max-w-4xl flex-col gap-6">
        <Section n={1} title="Name and product">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign name" htmlFor="c-name" error={nameError}>
              <Input id="c-name" value={f.name} maxLength={120} aria-invalid={!!nameError} onChange={(e) => { set("name", e.target.value); setNameError(null); }} />
            </Field>
            <Field label="Product" htmlFor="c-product" hint="Only leads and templates for this product are used.">
              <Select id="c-product" value={f.product} onChange={(e) => setF((x) => ({ ...x, product: e.target.value as Product, templateId: "" }))}>
                <option value="classwell">Classwell</option>
                <option value="vetlin">Vetlin</option>
                <option value="postwala">Postwala</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section n={2} title="Audience" description="Pick a saved view from the Leads screen, or select leads there and choose Add to email campaign.">
          <div className="flex flex-col gap-3">
            {selectedIds.length ? (
              <label className="flex items-center gap-2 text-body">
                <input type="radio" name="aud" checked={f.audienceType === "leads"} onChange={() => set("audienceType", "leads")} />
                {formatNumber(selectedIds.length)} leads selected on the Leads screen
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-body">
              <input type="radio" name="aud" checked={f.audienceType === "view"} onChange={() => set("audienceType", "view")} disabled={!views.length} />
              A saved view
            </label>
            {f.audienceType === "view" ? (
              views.length ? (
                <Field label="Saved view" htmlFor="c-view" className="max-w-sm">
                  <Select id="c-view" value={f.viewId} onChange={(e) => set("viewId", e.target.value)}>
                    {views.map((v) => <option key={v.id} value={v.id}>{v.name}{v.mine ? "" : " (shared)"}</option>)}
                  </Select>
                </Field>
              ) : (
                <p className="text-body text-fg-muted">No saved views yet. On the Leads screen, filter the leads you want and save the view.</p>
              )
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={busy === "build"} onClick={build}><Users /> {built ? "Rebuild audience" : "Build audience"}</Button>
              <span className="text-helper text-fg-muted">Picks each lead&apos;s verified email and skips anyone who should not get it.</span>
            </div>
            {built ? (
              <div className="rounded-control border border-border p-3">
                <p className="text-body font-medium text-fg">{formatNumber(built.added)} leads will get this email.</p>
                {built.skipped || built.noEmail ? (
                  <ul className="mt-2 flex flex-col gap-1 text-helper text-fg-muted">
                    {Object.entries(built.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}>{formatNumber(n)} skipped: {k}</li>)}
                    {built.noEmail ? <li>{formatNumber(built.noEmail)} have no email address</li> : null}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </Section>

        <Section n={3} title="Template and language">
          {productTemplates.length ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Template" htmlFor="c-template" className="min-w-64 flex-1">
                <Select id="c-template" value={f.templateId} onChange={(e) => set("templateId", e.target.value)}>
                  <option value="">Choose a template</option>
                  {productTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language === "ur" ? "Urdu" : "English"})</option>)}
                </Select>
              </Field>
              {template ? <Button variant="ghost" asChild><Link href={`/templates/email/${template.id}`} target="_blank">Open template</Link></Button> : null}
            </div>
          ) : (
            <p className="text-body text-fg-muted">No email templates for this product. <Link className="text-brand-600 underline" href={`/templates/email/new?product=${f.product}`}>Create one</Link>.</p>
          )}
          <p className="mt-2 text-helper text-fg-muted">The language comes from the template. The subject and body are copied when the campaign starts, so later edits to the template do not change it.</p>
        </Section>

        <Section n={4} title="Sender">
          {senders.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Send from" htmlFor="c-sender" hint="The domain must be verified in Resend.">
                <Select id="c-sender" value={f.senderId} onChange={(e) => set("senderId", e.target.value)}>
                  <option value="">Choose a sender</option>
                  {senders.map((s) => <option key={s.id} value={s.id} disabled={!s.is_active}>{s.from_name} &lt;{s.from_email}&gt;{s.is_active ? "" : " (turned off)"}</option>)}
                </Select>
              </Field>
              <Field label="Sender name (optional)" htmlFor="c-sender-name" hint="Shown as the From name. Leave empty to use the sender's name.">
                <Input id="c-sender-name" value={f.senderName} maxLength={80} onChange={(e) => set("senderName", e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="text-body text-fg-muted">No sender address yet. An Admin adds one in Settings, Sender identities.</p>
          )}
        </Section>

        <Section n={5} title="Sending controls" description="All times are Pakistan time.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Daily limit for this campaign" htmlFor="c-daily" hint={`Empty uses the overall limit of ${formatNumber(limits.daily_cap)} a day. The warm-up schedule can lower it.`}>
              <Input id="c-daily" inputMode="numeric" value={f.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Send from" htmlFor="c-start">
              <Input id="c-start" type="time" value={f.windowStart} onChange={(e) => set("windowStart", e.target.value)} />
            </Field>
            <Field label="Send until" htmlFor="c-end">
              <Input id="c-end" type="time" value={f.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} />
            </Field>
            <Field label="Gap between emails (seconds)" htmlFor="c-gap">
              <Input id="c-gap" inputMode="numeric" value={f.gapSeconds} onChange={(e) => set("gapSeconds", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Skip leads contacted in the last (days)" htmlFor="c-recent" hint="0 turns this off.">
              <Input id="c-recent" inputMode="numeric" value={f.recentContactDays} onChange={(e) => set("recentContactDays", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <div />
            <Field label="Pause if bounces pass (%)" htmlFor="c-bounce">
              <Input id="c-bounce" inputMode="decimal" value={f.bounceLimitPct} onChange={(e) => set("bounceLimitPct", e.target.value)} />
            </Field>
            <Field label="Pause if spam reports pass (%)" htmlFor="c-complaint">
              <Input id="c-complaint" inputMode="decimal" value={f.complaintLimitPct} onChange={(e) => set("complaintLimitPct", e.target.value)} />
            </Field>
            <div />
            <Field label="Automatic follow-ups" htmlFor="c-fu" hint="Sent only when there is no reply. Follow-ups start sending once step 8 is built.">
              <Select id="c-fu" value={f.maxFollowUps} onChange={(e) => set("maxFollowUps", e.target.value)}>
                <option value="0">None</option>
                <option value="1">1 follow-up</option>
                <option value="2">2 follow-ups</option>
                <option value="3">3 follow-ups</option>
              </Select>
            </Field>
            {f.maxFollowUps !== "0" ? (
              <Field label="Days without a reply before each follow-up" htmlFor="c-fu-days">
                <Input id="c-fu-days" inputMode="numeric" value={f.followUpDays} onChange={(e) => set("followUpDays", e.target.value.replace(/\D/g, ""))} />
              </Field>
            ) : null}
          </div>
        </Section>

        <Section n={6} title="Safeguards" description="Checked again for every email at the moment it is sent.">
          <ul className="flex flex-col gap-2 text-body">
            {[
              "Only verified emails are sent.",
              "Do-not-contact and opted-out contacts are skipped.",
              `Leads contacted in the last ${f.recentContactDays || 0} days are skipped.`,
              "Every email carries an unsubscribe link and one-click unsubscribe.",
              "Sending stops when the Resend plan cap or a budget is reached.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {t}</li>
            ))}
          </ul>
          <Button className="mt-4" loading={busy === "test"} onClick={test} disabled={!f.templateId || !f.senderId}><Send /> Send a test to yourself</Button>
        </Section>

        <Section n={7} title="Schedule">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-body">
              <input type="radio" name="when" checked={whenMode === "now"} onChange={() => setWhenMode("now")} /> Start now (within the sending hours)
            </label>
            <label className="flex items-center gap-2 text-body">
              <input type="radio" name="when" checked={whenMode === "later"} onChange={() => setWhenMode("later")} /> Start at a set time
            </label>
            {whenMode === "later" ? (
              <Field label="Start (Pakistan time)" htmlFor="c-when" className="max-w-xs">
                <Input id="c-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
            ) : null}
            <div>
              <Button variant="primary" disabled={!canStart} onClick={() => setConfirm(true)}>
                {whenMode === "now" ? "Start campaign" : "Schedule campaign"}
              </Button>
              {!canStart ? <p className="mt-2 text-helper text-fg-muted">Build the audience, choose a template and a sender{whenMode === "later" ? ", and pick a start time" : ""} first.</p> : null}
            </div>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={whenMode === "now" ? "Start this campaign?" : "Schedule this campaign?"}
        description={`${formatNumber(built?.added ?? 0)} leads will get "${template?.name ?? "the template"}", up to the daily limit, within ${f.windowStart}–${f.windowEnd} Pakistan time.`}
        confirmLabel={whenMode === "now" ? "Start sending" : "Schedule"}
        loading={busy === "start"}
        onConfirm={start}
      />
    </>
  );
}

function Section({ n, title, description, children }: { n: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-brand-50 text-helper font-semibold text-brand-700">{n}</span>{title}</span>} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}
