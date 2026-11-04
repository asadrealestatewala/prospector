import { StatusChip, type Tone } from "@/components/ui/chips";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "done" | "stopped";

const STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  sending: { label: "Sending", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  done: { label: "Done", tone: "neutral" },
  stopped: { label: "Stopped", tone: "error" },
};

export function CampaignStatusChip({ status, title }: { status: CampaignStatus; title?: string }) {
  return (
    <span title={title}>
      <StatusChip tone={STATUS[status].tone}>{STATUS[status].label}</StatusChip>
    </span>
  );
}

export const RECIPIENT_STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  sent: { label: "Sent", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  opened: { label: "Opened", tone: "success" },
  clicked: { label: "Clicked", tone: "success" },
  replied: { label: "Replied", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  bounced: { label: "Bounced", tone: "error" },
  complained: { label: "Marked as spam", tone: "error" },
  unsubscribed: { label: "Unsubscribed", tone: "warning" },
  opted_out: { label: "Opted out", tone: "warning" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export type Counts = {
  total: number; pending: number; queued: number; sent: number; delivered: number; opened: number; clicked: number;
  replied: number; bounced: number; complained: number; unsubscribed: number; failed: number; skipped: number;
};
export const ZERO_COUNTS: Counts = { total: 0, pending: 0, queued: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, complained: 0, unsubscribed: 0, failed: 0, skipped: 0 };

