import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StaffUser } from "@/lib/auth/session";

/** Appends an entry to the audit log. Never pass key values or passwords in details. */
export async function writeAudit(
  actor: Pick<StaffUser, "id" | "email"> | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    ip,
  });
  if (error) console.error("audit_log insert failed", { action, entityType, code: error.code });
}
