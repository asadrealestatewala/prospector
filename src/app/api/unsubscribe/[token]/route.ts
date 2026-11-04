import { NextResponse, type NextRequest } from "next/server";
import { unsubscribe } from "@/lib/email/unsubscribe-server";

export const dynamic = "force-dynamic";

/** One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await unsubscribe(token);
  return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 404 });
}

/** A person who opens the address in a browser gets the confirmation page instead. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(token)}`, req.url));
}
