import { NextResponse, type NextRequest } from "next/server";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { csvLine } from "@/lib/csv";
import { applyConsentFilters, CHANNEL_LABEL, CONSENT_EVENT_LABEL, CONSENT_SOURCE_LABEL, consentFilterSchema } from "@/lib/compliance/filters";
import { formatPkDateTime, pkToday } from "@/lib/utils";

const MAX_ROWS = 100_000;
const BATCH = 1000;

/** CSV of the consent log, filtered or for one lead "on request" (SRS screen 15). Logged in the audit log. */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    return NextResponse.json({ error: e instanceof AccessDeniedError ? e.message : "Not allowed" }, { status: 403 });
  }
  const filters = consentFilterSchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const supabase = await createSupabaseServerClient();
  const lines = [csvLine(["Date (Pakistan time)", "Lead", "Contact", "Channel", "Event", "Source", "Source page", "Note", "Recorded by"])];
  let count = 0;
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    let q = supabase.from("consent_log_view").select("id, occurred_at, lead_name, channel, value, event, source, source_url, note, recorded_by_name, recorded_by_system");
    q = applyConsentFilters(q, filters);
    const { data, error } = await q.order("occurred_at", { ascending: true }).order("id").range(from, from + BATCH - 1);
    if (error) return NextResponse.json({ error: "Could not read the consent log." }, { status: 500 });
    for (const r of data ?? []) {
      lines.push(
        csvLine([
          formatPkDateTime(r.occurred_at),
          r.lead_name,
          r.value,
          CHANNEL_LABEL[r.channel as keyof typeof CHANNEL_LABEL],
          CONSENT_EVENT_LABEL[r.event as keyof typeof CONSENT_EVENT_LABEL],
          CONSENT_SOURCE_LABEL[r.source as keyof typeof CONSENT_SOURCE_LABEL],
          r.source_url,
          r.note,
          r.recorded_by_name ?? r.recorded_by_system ?? "System",
        ]),
      );
    }
    count += data?.length ?? 0;
    if (!data || data.length < BATCH) break;
  }
  await writeAudit(actor, "consent.exported", filters.lead ? "lead" : "consent_log", filters.lead ?? null, { rows: count, filters });
  const name = filters.lead ? `consent-log-lead-${filters.lead.slice(0, 8)}` : "consent-log";
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${pkToday()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
