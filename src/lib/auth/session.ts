import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccess, isRole, type Role, type ScreenKey } from "@/lib/auth/roles";

export type StaffUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: "invited" | "active" | "deactivated";
  mustResetPassword: boolean;
  /** Has a verified authenticator but has not entered a code in this session. */
  needsMfaCode: boolean;
  /** An Admin requires two-step verification for this user and none is set up yet. */
  needsMfaSetup: boolean;
};

/** The signed-in staff member, verified against Supabase Auth and the users table. */
export const getCurrentUser = cache(async (): Promise<StaffUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase
    .from("users")
    .select("id, email, full_name, role, status, must_reset_password, mfa_required")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!profile || !isRole(profile.role)) return null;
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasFactor = aal?.nextLevel === "aal2";
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    status: profile.status,
    mustResetPassword: profile.must_reset_password,
    needsMfaCode: hasFactor && aal?.currentLevel !== "aal2",
    needsMfaSetup: profile.mfa_required && !hasFactor,
  };
});

/** For pages: signed-out visitors go to login, users without access see the forbidden screen. */
export async function requireScreen(screen: ScreenKey): Promise<StaffUser> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") redirect("/login");
  if (user.needsMfaCode) redirect("/login/mfa");
  if (user.mustResetPassword) redirect("/account/password");
  if (user.needsMfaSetup) redirect("/account/security");
  if (!canAccess(user.role, screen)) redirect("/forbidden");
  return user;
}

export class AccessDeniedError extends Error {
  constructor(message = "You do not have access to this action.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/** For server actions and route handlers: throws unless the user is active and has one of the roles. */
export async function requireRole(...roles: Role[]): Promise<StaffUser> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || user.needsMfaCode) throw new AccessDeniedError("Please sign in again.");
  if (!roles.includes(user.role)) throw new AccessDeniedError();
  return user;
}
