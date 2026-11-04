import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UsersScreen, type AuditRow, type UserRow } from "./users-screen";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireScreen("users");
  const supabase = await createSupabaseServerClient();
  const [{ data: users }, { data: audit }] = await Promise.all([
    supabase.from("users").select("id, full_name, email, role, status, last_login_at, mfa_required, must_reset_password, created_at").order("created_at"),
    supabase.from("audit_log").select("id, actor_email, action, entity_type, entity_id, details, created_at").order("created_at", { ascending: false }).limit(500),
  ]);
  return <UsersScreen meId={me.id} users={(users ?? []) as UserRow[]} audit={(audit ?? []) as AuditRow[]} />;
}
