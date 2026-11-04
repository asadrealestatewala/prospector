"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Pause, Play, Send, Square } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { KpiCard } from "@/components/ui/kpi-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toaster";
import type { EmailLimits } from "@/lib/email/limits";
import { formatNumber, formatPkDateTime } from "@/lib/utils";
import { sendCampaignTest, setEmailCampaignState } from "../actions";
import { CampaignStatusChip, RECIPIENT_STATUS_LABEL, type CampaignStatus, type Counts } from "../status";

export type DetailCampaign = {
  id: string;
  name: string;
  product: Product;
  status: CampaignStatus;
  audience_size: number;
  daily_limit: number | null;
  send_window_start: string | null;
  send_window_end: string | null;
  gap_seconds: number | null;
  max_follow_ups: number;
  follow_up_after_days: number | null;
  bounce_limit_pct: number | null;
  complaint_limit_pct: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  paused_reason: string | null;
  subject_snapshot: string | null;
  language: "en" | "ur";
};

export type RecipientRow = {
  id: string;
  lead_id: string;
  leadName: string;
  city: string | null;
  address: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  error: string | null;
};

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0%");

/** SRS screen 7 campaign detail: live counters, per-recipient table, pause, resume and stop. */
export function CampaignDetail({
  campaign: c, counts, recipients, total, page, size, filter, templateName, sender, limits,
}: {
  campaign: DetailCampaign;
  counts: Counts;
  recipients: RecipientRow[];
  total: number;
  page: number;
  size: number;
  filter: string;
  templateName: string | null;
  sender: { from_name: string; from_email: string } | null;
  limits: EmailLimits;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [confirm, setConfirm] = React.useState<null | "pause" | "resume" | "stop">(null);
  const [busy, setBusy] = React.useState<null | string>(null);

  const live = c.status === "sending" || c.status === "scheduled";
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [live, router]);

  async function act(action: "pause" | "resume" | "stop") {
    setBusy(action);
    const r = await setEmailCampaignState(c.id, action);
    setBusy(null);
    setConfirm(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    router.refresh();
  }

  function go(next: { status?: string; page?: number }) {
    const p = new URLSearchParams();
    const status = next.status ?? filter;
    if (status !== "all") p.set("status", status);
    if (next.page) p.set("page", String(next.page));
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  }

  const sendable = counts.total;
  const columns: Column<RecipientRow>[] = [
    { key: "lead", header: "Lead", sortable: false, cell: (r) => <Link href={`/leads/${r.lead_id}`} className="font-medium text-fg hover:text-brand-600 hover:underline">{r.leadName}</Link> },
    { key: "city", header: "City", sortable: false, cell: (r) => r.city ?? "" },
    { key: "address", header: "Email", sortable: false, cell: (r) => <span className="break-all">{r.address}</span> },
    { key: "status", header: "Status", sortable: false, cell: (r) => { const s = RECIPIENT_STATUS_LABEL[r.status] ?? { label: r.status, tone: "neutral" as const }; return <StatusChip tone={s.tone}>{s.label}</StatusChip>; } },
    { key: "sent", header: "Sent", sortable: false, cell: (r) => <span className="text-fg-muted">{r.sent_at ? formatPkDateTime(r.sent_at) : ""}</span> },
    { key: "note", header: "Note", sortable: false, cell: (r) => <span className="text-helper text-fg-muted">{r.error ?? ""}</span> },
  ];

  return (
    <>
      <Link href="/campaigns/email" className="mb-3 inline-flex items-center gap-1 text-helper text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Email Campaigns
      </Link>
      <PageHeader
        title={c.name}
        description={c.subject_snapshot ? `Subject: ${c.subject_snapshot}` : undefined}
        actions={
          <>
            <Button variant="ghost" loading={busy === "test"} onClick={async () => { setBusy("test"); const r = await sendCampaignTest(c.id); setBusy(null); if (r.ok) toast.success(r.message); else toast.error(r.error); }}><Send /> Send a test</Button>
            {c.status === "sending" || c.status === "scheduled" ? <Button onClick={() => setConfirm("pause")}><Pause /> Pause</Button> : null}
            {c.status === "paused" ? <Button variant="primary" onClick={() => setConfirm("resume")}><Play /> Resume</Button> : null}
            {c.status !== "done" && c.status !== "stopped" ? <Button variant="destructive" onClick={() => setConfirm("stop")}><Square /> Stop all</Button> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <CampaignStatusChip status={c.status} />
        <ProductChip product={c.product} />
        <span className="text-helper text-fg-muted">
          {c.status === "scheduled" && c.scheduled_at ? `Starts ${formatPkDateTime(c.scheduled_at)}` : c.started_at ? `Started ${formatPkDateTime(c.started_at)}` : null}
          {c.finished_at ? ` · Finished ${formatPkDateTime(c.finished_at)}` : null}
        </span>
      </div>
      {c.status === "paused" && c.paused_reason ? (
        <p className="mb-4 rounded-control bg-warning-soft px-3 py-2 text-body text-warning" role="status">{c.paused_reason}</p>
      ) : null}

      <div className="mb-6 flex flex-col gap-2">
        <ProgressBar value={counts.sent} max={Math.max(1, sendable)} label={`${formatNumber(counts.sent)} of ${formatNumber(sendable)} sent`} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
        {[
          { label: "Sent", n: counts.sent, rate: null, status: "sent" },
          { label: "Delivered", n: counts.delivered, rate: pct(counts.delivered, counts.sent), status: "delivered" },
          { label: "Opened", n: counts.opened, rate: pct(counts.opened, counts.delivered), status: "opened" },
          { label: "Clicked", n: counts.clicked, rate: pct(counts.clicked, counts.delivered), status: "clicked" },
          { label: "Replied", n: counts.replied, rate: null, status: "all" },
          { label: "Bounced", n: counts.bounced, rate: pct(counts.bounced, counts.sent), status: "bounced" },
          { label: "Unsubscribed", n: counts.unsubscribed, rate: pct(counts.unsubscribed, counts.sent), status: "unsubscribed" },
          { label: "Waiting", n: counts.pending + counts.queued, rate: null, status: "pending" },
        ].map((k) => (
          <KpiCard key={k.label} label={k.rate ? `${k.label} · ${k.rate}` : k.label} value={formatNumber(k.n)} href={k.status === "all" ? pathname : `${pathname}?status=${k.status}`} />
        ))}
      </div>
      {counts.skipped ? <p className="-mt-4 mb-6 text-helper text-fg-muted">{formatNumber(counts.skipped)} leads were skipped by the safeguards. Replies are counted once the Inbox is built (step 7).</p> : <p className="-mt-4 mb-6 text-helper text-fg-muted">Replies are counted once the Inbox is built (step 7).</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <DataTable
          rows={recipients}
          columns={columns}
          rowKey={(r) => r.id}
          toolbar={
            <div className="flex items-center gap-2">
              <label htmlFor="rec-status" className="text-helper text-fg-muted">Show</label>
              <Select id="rec-status" className="w-44" value={filter} onChange={(e) => go({ status: e.target.value, page: 0 })}>
                <option value="all">Everyone</option>
                <option value="pending">Waiting</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="opened">Opened</option>
                <option value="clicked">Clicked</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Marked as spam</option>
                <option value="unsubscribed">Unsubscribed</option>
                <option value="failed">Failed</option>
                <option value="skipped">Skipped</option>
              </Select>
            </div>
          }
          manual={{ total, page, pageSize: size, sort: null, onPage: (p) => go({ page: p }), onPageSize: () => {}, onSort: () => {} }}
          empty={<EmptyState icon={Send} message="No recipients match this filter." />}
        />
        <Card className="h-fit">
          <CardHeader title="Settings" />
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
              <dt className="text-fg-muted">Template</dt><dd>{templateName ?? "Deleted"}</dd>
              <dt className="text-fg-muted">From</dt><dd className="break-all">{sender ? `${sender.from_name} <${sender.from_email}>` : "Missing"}</dd>
              <dt className="text-fg-muted">Daily limit</dt><dd>{c.daily_limit ? formatNumber(c.daily_limit) : `Overall limit (${formatNumber(limits.daily_cap)})`}</dd>
              <dt className="text-fg-muted">Hours</dt><dd>{(c.send_window_start ?? limits.window_start).slice(0, 5)}–{(c.send_window_end ?? limits.window_end).slice(0, 5)} PKT</dd>
              <dt className="text-fg-muted">Gap</dt><dd>{c.gap_seconds ?? limits.gap_seconds} seconds</dd>
              <dt className="text-fg-muted">Follow-ups</dt><dd>{c.max_follow_ups ? `${c.max_follow_ups} after ${c.follow_up_after_days} days (from step 8)` : "None"}</dd>
              <dt className="text-fg-muted">Auto pause</dt><dd>Bounces over {c.bounce_limit_pct}% or spam reports over {c.complaint_limit_pct}%</dd>
            </dl>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "stop" ? "Stop this campaign?" : confirm === "pause" ? "Pause this campaign?" : "Resume this campaign?"}
        description={
          confirm === "stop"
            ? `${formatNumber(counts.pending)} emails that have not gone out yet will be cancelled. This cannot be undone.`
            : confirm === "pause"
              ? "No new emails are handed to Resend until you resume. Emails already handed over may still go out."
              : "Sending continues within the sending hours and limits. The cap and budget are checked again first."
        }
        confirmLabel={confirm === "stop" ? "Stop campaign" : confirm === "pause" ? "Pause" : "Resume"}
        destructive={confirm === "stop"}
        loading={busy === confirm}
        onConfirm={() => confirm && act(confirm)}
      />
    </>
  );
}
