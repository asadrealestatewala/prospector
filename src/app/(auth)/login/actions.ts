"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { lockedUntil, LOCK_MINUTES } from "@/lib/auth/lockout";
import { ROLE_HOME, isRole } from "@/lib/auth/roles";
import { safeNext } from "@/lib/auth/safe-next";
import { writeAudit } from "@/lib/audit";

export type LoginState = { error?: string; email?: string } | undefined;

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") };
  const { email, password, next } = parsed.data;

  const admin = createSupabaseAdminClient();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const { data: attempts } = await admin
    .from("login_attempts")
    .select("succeeded, created_at")
    .eq("email", email)
    .gte("created_at", new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  const until = lockedUntil(attempts ?? []);
  if (until) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return { error: `Too many failed attempts. This account is locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`, email };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  await admin.from("login_attempts").insert({ email, succeeded: !error, ip });

  if (error || !data.user) {
    return { error: "That email and password do not match. Check them and try again.", email };
  }

  const { data: profile } = await admin
    .from("users")
    .select("id, email, role, status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.status === "deactivated" || !isRole(profile.role)) {
    await supabase.auth.signOut();
    return { error: "This account is not active. Ask an Admin to give you access.", email };
  }

  await admin
    .from("users")
    .update({ last_login_at: new Date().toISOString(), status: "active" })
    .eq("id", profile.id);
  await writeAudit({ id: profile.id, email: profile.email }, "auth.login", "user", profile.id);

  // Two-step verification: if the user has a verified factor, finish the challenge first.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const target = safeNext(next) ?? ROLE_HOME[profile.role];
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/login/mfa?next=${encodeURIComponent(target)}`);
  }
  redirect(target);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await writeAudit({ id: data.user.id, email: data.user.email ?? "" }, "auth.logout", "user", data.user.id);
  await supabase.auth.signOut();
  redirect("/login");
}
