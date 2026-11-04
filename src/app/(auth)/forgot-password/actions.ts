"use server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ForgotState = { sent?: boolean; error?: string } | undefined;

export async function requestReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${appUrl}/auth/confirm?next=/account/password` });
  // Same answer whether or not the email exists, so accounts cannot be discovered.
  return { sent: true };
}
