"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";

export type MfaState = { error?: string } | undefined;

export async function verifyMfa(_prev: MfaState, form: FormData): Promise<MfaState> {
  const code = z.string().regex(/^\d{6}$/).safeParse(String(form.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success) return { error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  if (error) return { error: "That code did not work. Wait for a new code and try again." };
  redirect(safeNext(String(form.get("next") ?? "")) ?? "/");
}
