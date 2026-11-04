import { NextResponse, type NextRequest } from "next/server";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { applyLeadFilters, parseLeadFilters } from "@/lib/leads/filters";
import { LEAD_COLUMN_LABELS, LEAD_LIST_SELECT } from "@/lib/leads/columns";
import { LEAD_STATUS } from "@/lib/engine/labels";
import { PRODUCT_LABELS, type Product } from "@/components/ui/chips";
import { formatPkDateTime, pkToday } from "@/lib/utils";

/** CSV export of the filtered or selected leads (SRS screen 5). Logged in the audit log. */
const MAX_ROWS = 50_000;
const BATCH = 1000;

type Row = Record<string, unknown> & { owner: { full_name: string } | null; source: { name: string } | null };

const VALUE: Record<string, (r: Row) => unknown> = {
  name: (r) => r.name,
  product: (r) => PRODUCT_LABELS[r.product as Product],
  city: (r) => [r.area, r.city].filter(Boolean).join(", "),
  phone: (r) => r.phone,
  website: (r) => r.website,
  email: (r) => r.email,
  whatsapp: (r) => r.whatsapp,
  rating: (r) => r.google_rating,
  score: (r) => r.score,
  status: (r) => LEAD_STATUS[r.status as keyof typeof LEAD_STATUS]?.label ?? r.status,
  source: (r) => r.source?.name ?? "Manual",
  last_contacted: (r) => (r.last_contacted_at ? formatPkDateTime(r.last_contacted_at as string) : ""),
  owner: (r) => r.owner?.full_name ?? "",
  tags: (r) => (r.tags as string[]).join(" "),
  created: (r) => formatPkDateTime(r.created_at as string),
};

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireRole("admin", "manager", "lead_expert");
  } catch (e) {
    return NextResponse.json({ error: e instanceof AccessDeniedError ? e.message : "Not allowed" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const filters = parseLeadFilters(Object.fromEntries(sp.entries()));
  const ids = (sp.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5000);
  const cols = (sp.get("columns") ?? "").split(".").filter((c) => c in VALUE);
  const columns = cols.length ? cols : Object.keys(VALUE);

  const supabase = await createSupabaseServerClient();
  const select = filters.consent ? `${LEAD_LIST_SELECT}, lead_contacts!inner(consent_state)` : LEAD_LIST_SELECT;
  const lines = [columns.map((c) => esc(LEAD_COLUMN_LABELS[c])).join(",")];
  let count = 0;
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    let q = supabase.from("leads").select(select);
    q = ids.length ? q.in("id", ids) : applyLeadFilters(q, filters);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id").range(from, from + BATCH - 1);
    if (error) return NextResponse.json({ error: "Could not export leads." }, { status: 500 });
    for (const r of (data ?? []) as unknown as Row[]) lines.push(columns.map((c) => esc(VALUE[c](r))).join(","));
    count += data?.length ?? 0;
    if (!data || data.length < BATCH) break;
  }

  await writeAudit(actor, "lead.exported", "lead", null, { rows: count, selected: ids.length > 0, filters: { ...filters, q: filters.q ? "(text)" : undefined } });
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospector-leads-${pkToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
