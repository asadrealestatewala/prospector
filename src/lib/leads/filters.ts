import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/engine/labels";

/**
 * Leads screen filters (SRS screen 5), kept in the URL so views can be saved, shared and exported.
 * Shared by the page, the export route and saved views.
 */
const yesNo = z.enum(["1", "0"]).optional().catch(undefined);
const uuid = z.string().uuid().optional().catch(undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);
const int = z.coerce.number().int().min(0).max(1000).optional().catch(undefined);

export const LEAD_SORTS = ["created_at", "name", "city", "score", "google_rating", "last_contacted_at", "status"] as const;

export const leadFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  product: z.enum(["classwell", "vetlin", "postwala"]).optional().catch(undefined),
  city: z.string().trim().max(80).optional().catch(undefined),
  status: z.enum(LEAD_STATUSES).optional().catch(undefined),
  has_email: yesNo,
  has_whatsapp: yesNo,
  has_website: yesNo,
  score_min: int,
  score_max: int,
  search: uuid,
  owner: z.union([z.literal("none"), z.string().uuid()]).optional().catch(undefined),
  tag: z.string().trim().max(40).optional().catch(undefined),
  from: date,
  to: date,
  consent: z.enum(["unknown", "opted_in", "opted_out"]).optional().catch(undefined),
  sort: z.enum(LEAD_SORTS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(0).max(100000).optional().catch(undefined),
  size: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).optional().catch(undefined),
});
export type LeadFilters = z.infer<typeof leadFilterSchema>;

export const FILTER_KEYS = [
  "q", "product", "city", "status", "has_email", "has_whatsapp", "has_website", "score_min", "score_max",
  "search", "owner", "tag", "from", "to", "consent",
] as const;

export function parseLeadFilters(params: Record<string, string | string[] | undefined>): LeadFilters {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== "") flat[k] = s;
  }
  return leadFilterSchema.parse(flat);
}

export function filtersToParams(f: Partial<LeadFilters>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p;
}

/** Characters that would break a PostgREST "or" filter are removed from free-text search. */
export function cleanSearchText(q: string): string {
  return q.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim();
}

/** Applies the filters to a PostgREST query on leads. Works with any select. */
export function applyLeadFilters<Q extends { [k: string]: any }>(query: Q, f: LeadFilters): Q {
  let q = query;
  if (f.product) q = q.eq("product", f.product);
  if (f.city) q = q.ilike("city", f.city);
  if (f.status) q = q.eq("status", f.status);
  if (f.has_email === "1") q = q.not("email", "is", null);
  if (f.has_email === "0") q = q.is("email", null);
  if (f.has_whatsapp === "1") q = q.not("whatsapp", "is", null);
  if (f.has_whatsapp === "0") q = q.is("whatsapp", null);
  if (f.has_website === "1") q = q.not("website_domain", "is", null);
  if (f.has_website === "0") q = q.is("website_domain", null);
  if (f.score_min !== undefined) q = q.gte("score", f.score_min);
  if (f.score_max !== undefined) q = q.lte("score", f.score_max);
  if (f.search) q = q.eq("source_search_id", f.search);
  if (f.owner === "none") q = q.is("owner_id", null);
  else if (f.owner) q = q.eq("owner_id", f.owner);
  if (f.tag) q = q.contains("tags", [f.tag]);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00+05:00`);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999+05:00`);
  if (f.consent) q = q.eq("lead_contacts.consent_state", f.consent);
  if (f.q) {
    const t = cleanSearchText(f.q);
    if (t) {
      const digits = t.replace(/\D/g, "");
      const parts = [`name.ilike.*${t}*`, `email.ilike.*${t}*`, `website_domain.ilike.*${t}*`, `city.ilike.*${t}*`];
      // Phone search matches the last digits so 0300…, 300… and +92300… all work.
      if (digits.length >= 5) parts.push(`phone_e164.ilike.*${digits.replace(/^0/, "")}*`, `whatsapp.ilike.*${digits.slice(-7)}*`);
      q = q.or(parts.join(","));
    }
  }
  return q;
}
