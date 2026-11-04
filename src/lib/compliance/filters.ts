import { z } from "zod";

/** Filters for the Do-Not-Contact and Consent Log screens, kept in the URL (shared with the exports). */
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().catch(undefined);
const page = opt(z.coerce.number().int().min(0).max(100000));
const size = opt(z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)));
const date = opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const DNC_REASONS = ["unsubscribed", "replied_stop", "complained", "bounced", "manual"] as const;
export const DNC_REASON_LABEL: Record<(typeof DNC_REASONS)[number], string> = {
  unsubscribed: "Unsubscribed",
  replied_stop: "Replied stop",
  complained: "Complained",
  bounced: "Bounced",
  manual: "Manual",
};
export const CHANNELS = ["email", "whatsapp", "phone"] as const;
export const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = { email: "Email", whatsapp: "WhatsApp", phone: "Phone" };
export const CONSENT_EVENTS = ["collected", "opt_in", "opt_out"] as const;
export const CONSENT_EVENT_LABEL: Record<(typeof CONSENT_EVENTS)[number], string> = { collected: "Collected", opt_in: "Opted in", opt_out: "Opted out" };
export const CONSENT_SOURCES = ["google_listing", "website", "form", "inbound_message", "import", "manual"] as const;
export const CONSENT_SOURCE_LABEL: Record<(typeof CONSENT_SOURCES)[number], string> = {
  google_listing: "Google listing",
  website: "Website",
  form: "Form",
  inbound_message: "Inbound message",
  import: "Import",
  manual: "Manual",
};

export const dncFilterSchema = z.object({
  q: opt(z.string().trim().max(100)),
  channel: opt(z.enum(CHANNELS)),
  reason: opt(z.enum(DNC_REASONS)),
  removed: opt(z.enum(["1"])),
  page,
  size,
});
export type DncFilters = z.infer<typeof dncFilterSchema>;

export const consentFilterSchema = z.object({
  q: opt(z.string().trim().max(100)),
  channel: opt(z.enum(CHANNELS)),
  event: opt(z.enum(CONSENT_EVENTS)),
  source: opt(z.enum(CONSENT_SOURCES)),
  lead: opt(z.string().uuid()),
  from: date,
  to: date,
  page,
  size,
});
export type ConsentFilters = z.infer<typeof consentFilterSchema>;

export function flatParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== "") flat[k] = s;
  }
  return flat;
}

/** Text search safe for PostgREST ilike: characters that would break the filter are removed. */
const clean = (q: string) => q.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim();

export function applyDncFilters<Q extends { [k: string]: any }>(query: Q, f: DncFilters): Q {
  let q = query;
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.reason) q = q.eq("reason", f.reason);
  q = f.removed ? q.not("removed_at", "is", null) : q.is("removed_at", null);
  if (f.q) {
    const t = clean(f.q).toLowerCase();
    const digits = t.replace(/\D/g, "");
    if (t) q = digits.length >= 5 ? q.or(`value_normalized.ilike.*${t}*,value_normalized.ilike.*${digits.replace(/^0/, "")}*`) : q.ilike("value_normalized", `*${t}*`);
  }
  return q;
}

export function applyConsentFilters<Q extends { [k: string]: any }>(query: Q, f: ConsentFilters): Q {
  let q = query;
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.event) q = q.eq("event", f.event);
  if (f.source) q = q.eq("source", f.source);
  if (f.lead) q = q.eq("lead_id", f.lead);
  if (f.from) q = q.gte("occurred_at", `${f.from}T00:00:00+05:00`);
  if (f.to) q = q.lte("occurred_at", `${f.to}T23:59:59.999+05:00`);
  if (f.q) {
    const t = clean(f.q);
    if (t) q = q.or(`value.ilike.*${t}*,lead_name.ilike.*${t}*`);
  }
  return q;
}
