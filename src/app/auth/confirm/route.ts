import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * Landing point for invite and password-reset emails.
 * Accepts either a token hash (recommended email template) or a PKCE code.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next")) ?? "/account/password";
  const supabase = await createSupabaseServerClient();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  const target = request.nextUrl.clone();
  target.search = "";
  if (!ok) {
    target.pathname = "/login";
    target.searchParams.set("error", "link");
    return NextResponse.redirect(target);
  }
  // Accepting an invite activates the account (deactivated accounts stay deactivated).
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    await createSupabaseAdminClient().from("users").update({ status: "active" }).eq("id", auth.user.id).eq("status", "invited");
  }
  const [path, query] = next.split("?");
  target.pathname = path;
  if (query) target.search = `?${query}`;
  return NextResponse.redirect(target);
}
