import type { Tone } from "@/components/ui/chips";

export const SEARCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const LEAD_STATUSES = ["new", "contacted", "replied", "demo_booked", "trial", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "neutral" },
  contacted: { label: "Contacted", tone: "info" },
  replied: { label: "Replied", tone: "info" },
  demo_booked: { label: "Demo booked", tone: "warning" },
  trial: { label: "Trial", tone: "warning" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "error" },
};

export const CONSENT_LABEL: Record<string, string> = { unknown: "Unknown", opted_in: "Opted in", opted_out: "Opted out" };
