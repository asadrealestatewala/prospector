import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseEncryptionKey } from "@/lib/crypto/secrets";
import { readUnsubscribeToken } from "@/lib/email/unsubscribe";

export function readToken(token: string) {
  try {
    return readUnsubscribeToken(token, parseEncryptionKey(process.env.SETTINGS_ENCRYPTION_KEY));
  } catch {
    return null;
  }
}

/** Shows only the first letter and the domain, so a forwarded link does not reveal the address. */
export function maskAddress(address: string): string {
  const [user, domain] = address.split("@");
  return domain ? `${user.slice(0, 1)}***@${domain}` : "***";
}

export async function unsubscribe(token: string): Promise<{ ok: boolean; address?: string; already?: boolean }> {
  const target = readToken(token);
  if (!target) return { ok: false };
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("unsubscribe_email", {
    p_recipient: target.kind === "r" ? target.id : null,
    p_message: target.kind === "m" ? target.id : null,
  });
  const r = data as { found: boolean; address?: string; already?: boolean } | null;
  if (error || !r?.found) return { ok: false };
  return { ok: true, address: r.address ? maskAddress(r.address) : undefined, already: r.already };
}
