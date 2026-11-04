"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";

export type FormState = { error?: string; ok?: string } | undefined;

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .regex(/[A-Za-z]/, "Include at least one letter.")
      .regex(/\d/, "Include at least one number."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match.", path: ["confirm"] });

export async function setPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = passwordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: /same/i.test(error.message) ? "Choose a password you have not used here before." : "Could not change the password. Try again, or ask for a new reset link." };
  }
  await createSupabaseAdminClient().from("users").update({ must_reset_password: false, status: "active" }).eq("id", user.id);
  await writeAudit(user, "auth.password_changed", "user", user.id);
  redirect(ROLE_HOME[user.role]);
}

export type EnrollState = { factorId?: string; qr?: string; secret?: string; error?: string; done?: boolean } | undefined;

export async function startEnroll(): Promise<EnrollState> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) return { error: "Two-step verification is for Admins and Managers." };
  const supabase = await createSupabaseServerClient();
  // Clear any half-finished setup first.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Prospector ${Date.now()}` });
  if (error || !data) return { error: "Could not start setup. Try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnroll(_prev: EnrollState, form: FormData): Promise<EnrollState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { factorId, qr: String(form.get("qr") ?? ""), error: "Enter the 6-digit code from your app." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { factorId, qr: String(form.get("qr") ?? ""), error: "That code did not work. Wait for a new code and try again." };
  await writeAudit(user, "auth.mfa_enabled", "user", user.id);
  revalidatePath("/account/security");
  return { done: true };
}

export async function removeFactor(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.needsMfaSetup) return;
  const supabase = await createSupabaseServerClient();
  const factorId = String(form.get("factorId") ?? "");
  const { data: profile } = await supabase.from("users").select("mfa_required").eq("id", user.id).single();
  if (profile?.mfa_required) return; // An Admin requires it for this account.
  await supabase.auth.mfa.unenroll({ factorId });
  await writeAudit(user, "auth.mfa_disabled", "user", user.id);
  revalidatePath("/account/security");
}
