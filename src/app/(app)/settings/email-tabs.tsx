"use client";
import * as React from "react";
import { Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { EmailLimits } from "@/lib/email/limits";
import { formatPkDate } from "@/lib/utils";
import { addEmailSender, saveBranding, saveEmailLimits, savePriceLines, setEmailSenderActive } from "./actions";

type Run = (label: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => Promise<boolean>;
function useRun(): [string | null, Run] {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run: Run = async (label, fn) => {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(r.message ?? "Saved.");
    else toast.error(r.error ?? "Could not save.");
    return r.ok;
  };
  return [busy, run];
}

const digits = (s: string) => s.replace(/[^\d]/g, "");

/** Settings, Sending limits (SRS 8.4: limits start low and rise on the warm-up schedule). */
export function LimitsTab({ limits }: { limits: EmailLimits }) {
  const [busy, run] = useRun();
  const [v, setV] = React.useState<Record<string, string>>(
    Object.fromEntries(Object.entries(limits).filter(([k]) => k !== "warmup").map(([k, x]) => [k, String(x)])),
  );
  const [warmup, setWarmup] = React.useState(limits.warmup.map((w) => ({ from_day: String(w.from_day), limit: String(w.limit) })));
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Email limits" description="Defaults for new campaigns. All times are Pakistan time." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Most emails a day (all campaigns)" htmlFor="l-cap"><Input id="l-cap" inputMode="numeric" value={v.daily_cap} onChange={(e) => set("daily_cap", digits(e.target.value))} /></Field>
          <Field label="Gap between emails (seconds)" htmlFor="l-gap"><Input id="l-gap" inputMode="numeric" value={v.gap_seconds} onChange={(e) => set("gap_seconds", digits(e.target.value))} /></Field>
          <Field label="Send from" htmlFor="l-start"><Input id="l-start" type="time" value={v.window_start} onChange={(e) => set("window_start", e.target.value)} /></Field>
          <Field label="Send until" htmlFor="l-end"><Input id="l-end" type="time" value={v.window_end} onChange={(e) => set("window_end", e.target.value)} /></Field>
          <Field label="Skip leads contacted in the last (days)" htmlFor="l-recent"><Input id="l-recent" inputMode="numeric" value={v.recent_contact_days} onChange={(e) => set("recent_contact_days", digits(e.target.value))} /></Field>
          <div />
          <Field label="Pause a campaign if bounces pass (%)" htmlFor="l-bounce"><Input id="l-bounce" inputMode="decimal" value={v.bounce_limit_pct} onChange={(e) => set("bounce_limit_pct", e.target.value)} /></Field>
          <Field label="Pause if spam reports pass (%)" htmlFor="l-complaint"><Input id="l-complaint" inputMode="decimal" value={v.complaint_limit_pct} onChange={(e) => set("complaint_limit_pct", e.target.value)} /></Field>
          <Field label="Emails sent before the pause rule applies" htmlFor="l-sample" hint="Stops one early bounce from pausing a campaign."><Input id="l-sample" inputMode="numeric" value={v.min_sample} onChange={(e) => set("min_sample", digits(e.target.value))} /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Warm-up schedule" description="Daily limit per sending domain, counted from the domain's first sending day. The lowest of this, the campaign limit and the overall limit applies." />
        <CardBody className="flex flex-col gap-3">
          {warmup.map((w, i) => (
            <div key={i} className="flex items-end gap-3">
              <Field label="From day" htmlFor={`w-day-${i}`} className="w-28"><Input id={`w-day-${i}`} inputMode="numeric" value={w.from_day} onChange={(e) => setWarmup((o) => o.map((x, j) => (j === i ? { ...x, from_day: digits(e.target.value) } : x)))} /></Field>
              <Field label="Emails a day" htmlFor={`w-limit-${i}`} className="w-32"><Input id={`w-limit-${i}`} inputMode="numeric" value={w.limit} onChange={(e) => setWarmup((o) => o.map((x, j) => (j === i ? { ...x, limit: digits(e.target.value) } : x)))} /></Field>
              <Button variant="ghost" size="icon" aria-label={`Remove step ${i + 1}`} disabled={warmup.length === 1} onClick={() => setWarmup((o) => o.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <div>
            <Button size="sm" disabled={warmup.length >= 12} onClick={() => setWarmup((o) => [...o, { from_day: "", limit: "" }])}><Plus /> Add step</Button>
          </div>
        </CardBody>
      </Card>
      <div className="xl:col-span-2">
        <Button variant="primary" loading={busy === "limits"} onClick={() => run("limits", () => saveEmailLimits({ ...v, warmup }))}>Save sending limits</Button>
        <p className="mt-2 text-helper text-fg-muted">WhatsApp limits are added here in step 6.</p>
      </div>
    </div>
  );
}

export type SenderRow = { id: string; from_name: string; from_email: string; reply_to: string | null; is_active: boolean; domain: string; warmup_started_on: string | null };

/** Settings, Sender identities: addresses campaigns send from. */
export function SendersTab({ senders }: { senders: SenderRow[] }) {
  const [busy, run] = useRun();
  const [f, setF] = React.useState({ fromName: "", fromEmail: "", replyTo: "" });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Email senders" description="Use a separate outreach domain (SRS 9.3) with SPF, DKIM and DMARC set up, and verify it in Resend." />
        {senders.length ? (
          <ul className="divide-y divide-border">
            {senders.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{s.from_name} <span className="font-normal text-fg-muted">&lt;{s.from_email}&gt;</span></p>
                  <p className="text-helper text-fg-muted">
                    {s.reply_to ? `Replies go to ${s.reply_to}. ` : ""}
                    {s.warmup_started_on ? `Warming up since ${formatPkDate(s.warmup_started_on)}.` : "Not used yet; warm-up starts on the first send."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip tone={s.is_active ? "success" : "neutral"}>{s.is_active ? "On" : "Off"}</StatusChip>
                  <Button size="sm" loading={busy === s.id} onClick={() => run(s.id, () => setEmailSenderActive(s.id, !s.is_active))}>{s.is_active ? "Turn off" : "Turn on"}</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Mail} message="No sender addresses yet. Add the address campaigns will send from." />
        )}
      </Card>
      <Card>
        <CardHeader title="Add a sender" />
        <CardBody className="flex flex-col gap-4">
          <Field label="Sender name" htmlFor="s-name" hint="Shown in the inbox, for example Asad from Classwell."><Input id="s-name" value={f.fromName} maxLength={80} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></Field>
          <Field label="Sender address" htmlFor="s-email" hint="On a domain verified in Resend."><Input id="s-email" type="email" value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} /></Field>
          <Field label="Reply-to address (optional)" htmlFor="s-reply" hint="Where replies go, such as a monitored mailbox."><Input id="s-reply" type="email" value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} /></Field>
          <div>
            <Button variant="primary" loading={busy === "add"} onClick={async () => { if (await run("add", () => addEmailSender(f))) setF({ fromName: "", fromEmail: "", replyTo: "" }); }}><Plus /> Add sender</Button>
          </div>
          <p className="text-helper text-fg-muted">The connected WhatsApp number is added here in step 6.</p>
        </CardBody>
      </Card>
    </div>
  );
}

/** Settings, Branding: the email footer. */
export function BrandingTab({ footer }: { footer: string }) {
  const [busy, run] = useRun();
  const [v, setV] = React.useState(footer);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Email footer" description="Shown at the bottom of every email, above the unsubscribe link. Include your company name and postal address." />
      <CardBody className="flex flex-col gap-4">
        <Field label="Footer text" htmlFor="b-footer"><Textarea id="b-footer" value={v} maxLength={500} onChange={(e) => setV(e.target.value)} placeholder="Classwell, 12 Main Boulevard, Lahore" /></Field>
        <div><Button variant="primary" loading={busy === "b"} onClick={() => run("b", () => saveBranding({ emailFooter: v }))}>Save footer</Button></div>
        <p className="text-helper text-fg-muted">App colours follow the SRS 4A palette until the Agentify design tokens are approved.</p>
      </CardBody>
    </Card>
  );
}

/** Settings, Defaults: the {{product_price}} line used in templates. */
export function PriceLinesCard({ lines }: { lines: Record<string, string> }) {
  const [busy, run] = useRun();
  const [v, setV] = React.useState({ classwell: lines.classwell ?? "", vetlin: lines.vetlin ?? "", postwala: lines.postwala ?? "" });
  return (
    <Card>
      <CardHeader title="Product price lines" description="Fills {{product_price}} in email templates. Leave empty if a product has no public price." />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        {(["classwell", "vetlin", "postwala"] as const).map((p) => (
          <Field key={p} label={p === "classwell" ? "Classwell" : p === "vetlin" ? "Vetlin" : "Postwala"} htmlFor={`price-${p}`}>
            <Input id={`price-${p}`} value={v[p]} maxLength={120} onChange={(e) => setV({ ...v, [p]: e.target.value })} />
          </Field>
        ))}
        <div className="sm:col-span-3"><Button variant="primary" loading={busy === "p"} onClick={() => run("p", () => savePriceLines(v))}>Save price lines</Button></div>
      </CardBody>
    </Card>
  );
}
