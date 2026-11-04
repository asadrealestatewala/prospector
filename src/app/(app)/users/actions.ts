"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e instanceof Error && e.message.startsWith("USER:")) return { ok: false, error: e.message.slice(5) };
  console.error("users action failed", e instanceof Error ? e.name : "unknown");
  return { ok: false, error: "Something went wrong. Nothing was changed. Try again." };
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

async function activeAdminCount(excludeId?: string) {
  const admin = createSupabaseAdminClient();
  let q = admin.from("users").select("id", { count: "exact", head: true }).eq("role", "admin").eq("status", "active");
  if (excludeId) q = q.neq("id", excludeId);
  const { count } = await q;
  return count ?? 0;
}

async function loadTarget(id: string) {
  const { data } = await createSupabaseAdminClient().from("users").select("id, email, role, status").eq("id", id).maybeSingle();
  if (!data) throw new Error("USER:That user no longer exists.");
  return data as { id: string; email: string; role: Role; status: string };
}

const inviteSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the person's name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(ROLES),
  mfaRequired: z.boolean().default(false),
});

export async function inviteUser(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin");
    const v = inviteSchema.parse(input);
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, {
      data: { full_name: v.fullName },
      redirectTo: `${appUrl()}/auth/confirm?next=/account/password`,
    });
    if (error || !data.user) {
      if (error && /already/i.test(error.message)) throw new Error("USER:Someone with that email already has an account.");
      throw new Error("USER:Supabase could not send the invite. Check the email settings in Supabase and try again.");
    }
    await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: v.role, invited_by: actor.id } });
    await admin
      .from("users")
      .upsert({
        id: data.user.id,
        email: v.email,
        full_name: v.fullName,
        role: v.role,
        status: "invited",
        invited_by: actor.id,
        mfa_required: v.mfaRequired && (v.role === "admin" || v.role === "manager"),
      });
    await writeAudit(actor, "user.invited", "user", data.user.id, { email: v.email, role: v.role });
    revalidatePath("/users");
    return { ok: true, message: `Invite sent to ${v.email}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function changeRole(userId: string, role: Role): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin");
    const newRole = z.enum(ROLES).parse(role);
    if (userId === actor.id) throw new Error("USER:You cannot change your own role. Ask another Admin.");
    const target = await loadTarget(userId);
    if (target.role === "admin" && newRole !== "admin" && (await activeAdminCount(userId)) === 0) {
      throw new Error("USER:Prospector needs at least one active Admin.");
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("users").update({ role: newRole }).eq("id", userId);
    if (error) throw error;
    await admin.auth.admin.updateUserById(userId, { app_metadata: { role: newRole } });
    await writeAudit(actor, "user.role_changed", "user", userId, { email: target.email, from: target.role, to: newRole });
    revalidatePath("/users");
    return { ok: true, message: `${target.email} is now ${ROLE_LABELS[newRole]}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setActive(userId: string, active: boolean): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin");
    if (userId === actor.id) throw new Error("USER:You cannot deactivate your own account.");
    const target = await loadTarget(userId);
    if (!active && target.role === "admin" && (await activeAdminCount(userId)) === 0) {
      throw new Error("USER:Prospector needs at least one active Admin.");
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("users").update({ status: active ? "active" : "deactivated" }).eq("id", userId);
    if (error) throw error;
    // A ban stops sign-in and refresh immediately; lifting it restores access.
    await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
    await writeAudit(actor, active ? "user.reactivated" : "user.deactivated", "user", userId, { email: target.email });
    revalidatePath("/users");
    return { ok: true, message: active ? `${target.email} can sign in again.` : `${target.email} can no longer sign in.` };
  } catch (e) {
    return fail(e);
  }
}

export async function forcePasswordReset(userId: string): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin");
    const target = await loadTarget(userId);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("users").update({ must_reset_password: true }).eq("id", userId);
    if (error) throw error;
    await admin.auth.resetPasswordForEmail(target.email, { redirectTo: `${appUrl()}/auth/confirm?next=/account/password` });
    await writeAudit(actor, "user.password_reset_forced", "user", userId, { email: target.email });
    revalidatePath("/users");
    return { ok: true, message: `${target.email} must choose a new password at next sign in. A reset link was emailed.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setMfaRequired(userId: string, required: boolean): Promise<ActionResult> {
  try {
    const actor = await requireRole("admin");
    const target = await loadTarget(userId);
    if (required && target.role !== "admin" && target.role !== "manager") {
      throw new Error("USER:Two-step verification is for Admins and Managers.");
    }
    const { error } = await createSupabaseAdminClient().from("users").update({ mfa_required: required }).eq("id", userId);
    if (error) throw error;
    await writeAudit(actor, required ? "user.mfa_required" : "user.mfa_optional", "user", userId, { email: target.email });
    revalidatePath("/users");
    return { ok: true, message: required ? `${target.email} must use two-step verification.` : `Two-step verification is optional for ${target.email}.` };
  } catch (e) {
    return fail(e);
  }
}

/** Logs a CSV export of the users or audit list (exports are audited, SRS screen 17). */
export async function logExport(what: string, count: number) {
  const actor = await requireRole("admin");
  await writeAudit(actor, "export.csv", what, null, { rows: count });
}
