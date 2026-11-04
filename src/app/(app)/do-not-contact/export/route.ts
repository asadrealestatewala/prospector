import { NextResponse, type NextRequest } from "next/server";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { csvLine } from "@/lib/csv";
import { applyDncFilters, CHANNEL_LABEL, CONSENT_SOURCE_LABEL, DNC_REASON_LABEL, dncFilterSchema } from "@/lib/compliance/filters";
import { formatPkDateTime, pkToday } from "@/lib/utils";

const MAX_ROWS = 100_000;
const BATCH = 1000;

/** CSV of the filtered do-not-contact list (SRS screen 14). Admin only, logged in the audit log. */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    return NextResponse.json({ error: e instanceof AccessDeniedError ? e.message : "Not allowed" }, { status: 403 });
  }
  const filters = dncFilterSchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const supabase = await createSupabaseServerClient();
  const lines = [csvLine(["Email or phone", "Channel", "Reason", "Source", "Note", "Lead", "Added", "Added by", "Removed", "Removal reason"])];
  let count = 0;
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    let q = supabase
      .from("do_not_contact")
      .select("id, channel, value, reason, source, note, created_at, removed_at, removal_reason, added_by_system, lead:leads(name), adder:users!do_not_contact_added_by_fkey(full_name)");
    q = applyDncFilters(q, filters);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id").range(from, from + BATCH - 1);
    if (error) return NextResponse.json({ error: "Could not read the list." }, { status: 500 });
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const lead = r.lead as { name: string } | null;
      const adder = r.adder as { full_name: string } | null;
      lines.push(
        csvLine([
          r.value,
          CHANNEL_LABEL[r.channel as keyof typeof CHANNEL_LABEL],
          DNC_REASON_LABEL[r.reason as keyof typeof DNC_REASON_LABEL],
          CONSENT_SOURCE_LABEL[r.source as keyof typeof CONSENT_SOURCE_LABEL],
          r.note,
          lead?.name,
          formatPkDateTime(r.created_at as string),
          adder?.full_name ?? r.added_by_system ?? "System",
          r.removed_at ? formatPkDateTime(r.removed_at as string) : "",
          r.removal_reason,
        ]),
      );
    }
    count += data?.length ?? 0;
    if (!data || data.length < BATCH) break;
  }
  await writeAudit(actor, "dnc.exported", "do_not_contact", null, { rows: count, filters });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="do-not-contact-${pkToday()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
