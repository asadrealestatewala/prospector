import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSecret } from "@/lib/integrations/settings-store";
import { parseResendEvent, verifyResendSignature } from "@/lib/email/resend";
import { checkEmailAllowance } from "@/lib/engine/budget";

export const dynamic = "force-dynamic";

/**
 * Resend delivery events (SRS 8.2): delivered, opened, clicked, bounced, complained, failed.
 * Each event is checked against the signing secret, stored once in webhook_events, then applied.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > 256_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const secret = await getSecret("resend.webhook_secret").catch(() => null);
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const h = { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") };
  if (!verifyResendSignature(secret, h, body)) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const event = parseResendEvent(payload);
  const db = createSupabaseAdminClient();
  const { data: stored, error } = await db
    .from("webhook_events")
    .insert({ provider: "resend", event_type: event?.type ?? null, provider_event_id: h.id, signature_valid: true, payload, attempts: 1 })
    .select("id")
    .maybeSingle();
  if (error) {
    // Already stored: Resend is retrying an event we have.
    if (error.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: "could not store" }, { status: 500 });
  }

  if (!event?.emailId) {
    await db.from("webhook_events").update({ status: "ignored", processed_at: new Date().toISOString(), error: "No email id" }).eq("id", stored!.id);
    return NextResponse.json({ ok: true });
  }
  const { period } = await checkEmailAllowance(db, null, 0);
  const { data: result, error: procError } = await db.rpc("process_resend_event", {
    p_type: event.type,
    p_email_id: event.emailId,
    p_at: event.at,
    p_bounce_type: event.bounceType,
    p_period_start: period.start,
    p_period_end: period.end,
  });
  await db
    .from("webhook_events")
    .update({
      status: procError ? "failed" : String(result).startsWith("ignored") ? "ignored" : "processed",
      error: procError ? procError.message.slice(0, 300) : String(result).startsWith("ignored") ? String(result) : null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", stored!.id);
  // A failure is recorded on the event and answered with 500 so Resend tries again later.
  if (procError) return NextResponse.json({ error: "could not apply" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
