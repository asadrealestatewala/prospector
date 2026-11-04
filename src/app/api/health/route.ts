import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness check for PM2 and uptime monitors. Reveals nothing about configuration. */
export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
