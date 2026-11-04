/**
 * Unsubscribe links (SRS 8.4). The token names the campaign recipient (r) or the one-off message (m)
 * and is signed with a key derived from SETTINGS_ENCRYPTION_KEY, so links cannot be guessed or forged.
 * No server-only imports: the worker builds links too.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export type UnsubscribeTarget = { kind: "r" | "m"; id: string };

const UUID = /^[0-9a-f]{32}$/;

function signingKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, Buffer.alloc(0), "prospector-unsubscribe-v1", 32));
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 32);
}

export function makeUnsubscribeToken(target: UnsubscribeTarget, encryptionKey: Buffer): string {
  const hex = target.id.replace(/-/g, "").toLowerCase();
  if (!UUID.test(hex)) throw new Error("Unsubscribe links need a row id.");
  const payload = `${target.kind}${hex}`;
  return `${payload}.${sign(signingKey(encryptionKey), payload)}`;
}

export function readUnsubscribeToken(token: string, encryptionKey: Buffer): UnsubscribeTarget | null {
  const m = /^([rm])([0-9a-f]{32})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m) return null;
  const expected = Buffer.from(sign(signingKey(encryptionKey), `${m[1]}${m[2]}`));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const h = m[2];
  return { kind: m[1] as "r" | "m", id: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
}

export function unsubscribeUrls(appUrl: string, token: string) {
  const base = appUrl.replace(/\/$/, "");
  // The page asks for a click (so link scanners do not unsubscribe people); the API address takes
  // the one-click POST that mail apps send (RFC 8058).
  return { page: `${base}/u/${token}`, oneClick: `${base}/api/unsubscribe/${token}` };
}
