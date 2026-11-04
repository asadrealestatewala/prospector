/**
 * Resend API (SRS 8.2): sending one email, and reading Resend's webhook events.
 * The API key is sent only in the Authorization header and never logged.
 * No server-only imports: the worker uses this module.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export class ResendError extends Error {
  /**
   * fatal: retrying cannot help (for example a bad address).
   * pause: the problem affects every email (wrong key, unverified domain, quota), so the campaign pauses.
   */
  constructor(message: string, readonly fatal: boolean, readonly pause = false, readonly status?: number) {
    super(message);
    this.name = "ResendError";
  }
}

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
};

/** "Name <address>" with characters that would break the header removed from the name. */
export function formatFrom(name: string, address: string): string {
  const clean = name.replace(/["<>\r\n]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

/**
 * Sends one email. The idempotency key makes a retried job safe: Resend returns the first result
 * for the same key instead of sending again (keys are kept for 24 hours).
 */
export async function sendWithResend(apiKey: string, email: OutgoingEmail, idempotencyKey: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo || undefined,
        headers: email.headers,
        tags: email.tags,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ResendError("Resend did not answer.", false);
  }
  let body: { id?: string; name?: string; message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // An empty or unreadable body is handled by the status below.
  }
  if (res.ok && body.id) return { id: body.id };
  throw resendFailure(res.status, body.name ?? "", body.message ?? "");
}

export function resendFailure(status: number, name: string, message: string): ResendError {
  const n = name.toLowerCase();
  if (status === 401 || /api_key/.test(n)) return new ResendError("Resend refused the API key. Check it in Settings.", true, true, status);
  if (n === "invalid_from_address" || (status === 403 && /domain/i.test(message))) {
    return new ResendError("The sending domain is not verified in Resend. Verify it in Resend, then resume the campaign.", true, true, status);
  }
  if (/quota/.test(n)) return new ResendError("The Resend sending quota is used up. Sending resumes when the quota resets or the plan is raised.", true, true, status);
  if (status === 403) return new ResendError("Resend refused to send this email.", true, true, status);
  if (status === 429 || n === "concurrent_idempotent_requests" || status === 409 || status >= 500) {
    return new ResendError(`Resend is busy (error ${status}).`, false, false, status);
  }
  if (status === 422 || n === "validation_error") return new ResendError("Resend did not accept this address or email.", true, false, status);
  return new ResendError(`Resend could not send the email (error ${status}).`, true, false, status);
}

/**
 * Checks a Resend webhook signature. Resend signs webhooks with Svix: the secret starts with
 * "whsec_", the signed text is "id.timestamp.body", and events older than five minutes are refused.
 */
export function verifyResendSignature(
  secret: string,
  h: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${body}`).digest("base64"));
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type ResendEvent = { type: string; emailId: string | null; at: string; bounceType: string | null };

export function parseResendEvent(payload: unknown): ResendEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; created_at?: unknown; bounce?: { type?: unknown } } };
  if (typeof p.type !== "string") return null;
  const at = typeof p.created_at === "string" && !Number.isNaN(Date.parse(p.created_at)) ? p.created_at : new Date().toISOString();
  return {
    type: p.type,
    emailId: typeof p.data?.email_id === "string" ? p.data.email_id : null,
    at,
    bounceType: typeof p.data?.bounce?.type === "string" ? p.data.bounce.type : null,
  };
}
