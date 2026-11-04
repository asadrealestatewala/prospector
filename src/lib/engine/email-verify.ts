/**
 * Email verification (SRS 8.2, 8.3 email-verify queue). Free checks run first (format, throwaway
 * domains, a mail server for the domain); only addresses that pass them are sent to the paid service.
 * No server-only imports: the worker uses this module.
 */

export type VerifyResult = "valid" | "risky" | "invalid";
export type ProviderId = "millionverifier" | "zerobounce" | "neverbounce";

export const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: "millionverifier", name: "MillionVerifier" },
  { id: "zerobounce", name: "ZeroBounce" },
  { id: "neverbounce", name: "NeverBounce" },
];
export const isProviderId = (v: unknown): v is ProviderId => PROVIDERS.some((p) => p.id === v);

// Common throwaway-mail domains. Short on purpose; the paid services catch the rest.
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "yopmail.com", "yopmail.net", "trashmail.com", "getnada.com",
  "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com",
  "mailnesia.com", "moakt.com", "tempail.com", "spamgourmet.com", "burnermail.io", "33mail.com", "inboxkitten.com",
]);
const FORMAT = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export type LocalCheck = { pass: true; detail: string } | { pass: false; result: VerifyResult; detail: string };

/**
 * Free checks. `resolveMx` returns the domain's mail servers (an empty list when it has none) and
 * throws when DNS cannot be reached, in which case the address is left for the paid check.
 */
export async function localCheck(email: string, resolveMx: (domain: string) => Promise<string[]>): Promise<LocalCheck> {
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !FORMAT.test(e) || e.includes("..") || e.split("@")[0].length > 64) {
    return { pass: false, result: "invalid", detail: "The address is not written correctly." };
  }
  const domain = e.split("@")[1];
  if (DISPOSABLE.has(domain)) return { pass: false, result: "invalid", detail: "The address uses a throwaway email service." };
  try {
    const mx = await resolveMx(domain);
    if (mx.length === 0) return { pass: false, result: "invalid", detail: `The domain ${domain} cannot receive email (no mail server).` };
  } catch {
    return { pass: true, detail: "The mail server could not be looked up." };
  }
  return { pass: true, detail: "Format and mail server are fine." };
}

export class ProviderError extends Error {
  /** True when retrying cannot help: a wrong key or no credits left. */
  constructor(message: string, readonly fatal: boolean) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderVerdict = { result: VerifyResult; detail: string };

const DETAIL: Record<VerifyResult, string> = {
  valid: "The mailbox exists.",
  risky: "The mail server accepts every address, so this one cannot be confirmed.",
  invalid: "The mailbox does not exist.",
};

/**
 * Calls the chosen service for one address. The key is sent as the service requires and is never logged.
 * Response shapes follow each service's public documentation.
 */
export async function verifyWithProvider(
  provider: ProviderId,
  apiKey: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderVerdict> {
  const e = encodeURIComponent(email.trim());
  const k = encodeURIComponent(apiKey);
  const req: { url: string; method: string } =
    provider === "millionverifier"
      ? { url: `https://api.millionverifier.com/api/v3/?api=${k}&email=${e}&timeout=20`, method: "GET" }
      : provider === "zerobounce"
        ? { url: `https://api.zerobounce.net/v2/validate?api_key=${k}&email=${e}&ip_address=`, method: "GET" }
        : { url: `https://api.neverbounce.com/v4/single/check?key=${k}&email=${e}`, method: "POST" };

  let res: Response;
  try {
    res = await fetchImpl(req.url, { method: req.method, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ProviderError("The verification service did not answer.", false);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("The verification service refused the API key.", true);
  if (res.status === 402) throw new ProviderError("The verification service account has no credits left.", true);
  if (res.status === 429 || res.status >= 500) throw new ProviderError(`The verification service is busy (error ${res.status}).`, false);
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ProviderError("The verification service sent an answer that could not be read.", false);
  }
  return mapProviderResponse(provider, body);
}

export function mapProviderResponse(provider: ProviderId, body: Record<string, unknown>): ProviderVerdict {
  const lower = (v: unknown) => String(v ?? "").toLowerCase();
  if (provider === "millionverifier") {
    const err = lower(body.error);
    if (err) {
      if (/api ?key|apikey|unauthori[sz]ed/.test(err)) throw new ProviderError("The verification service refused the API key.", true);
      if (/credit/.test(err)) throw new ProviderError("The verification service account has no credits left.", true);
      throw new ProviderError("The verification service reported an error.", false);
    }
    const r = lower(body.result);
    if (r === "ok") return { result: "valid", detail: DETAIL.valid };
    if (r === "catch_all") return { result: "risky", detail: DETAIL.risky };
    if (r === "unknown") return { result: "risky", detail: "The address could not be confirmed right now." };
    if (r === "disposable") return { result: "invalid", detail: "The address uses a throwaway email service." };
    if (r === "invalid") return { result: "invalid", detail: DETAIL.invalid };
    throw new ProviderError("The verification service sent an unexpected answer.", false);
  }
  if (provider === "zerobounce") {
    const err = lower(body.error);
    if (err) {
      if (/api ?key|invalid key/.test(err)) throw new ProviderError("The verification service refused the API key.", true);
      if (/credit/.test(err)) throw new ProviderError("The verification service account has no credits left.", true);
      throw new ProviderError("The verification service reported an error.", false);
    }
    const s = lower(body.status);
    if (s === "valid") return { result: "valid", detail: DETAIL.valid };
    if (s === "catch-all" || s === "unknown") return { result: "risky", detail: s === "unknown" ? "The address could not be confirmed right now." : DETAIL.risky };
    if (s === "spamtrap" || s === "abuse" || s === "do_not_mail") {
      return { result: "invalid", detail: `The service advises not to email this address (${s.replaceAll("_", " ")}).` };
    }
    if (s === "invalid") return { result: "invalid", detail: DETAIL.invalid };
    throw new ProviderError("The verification service sent an unexpected answer.", false);
  }
  // NeverBounce
  if (lower(body.status) !== "success") {
    const s = lower(body.status);
    if (s === "auth_failure") throw new ProviderError("The verification service refused the API key.", true);
    if (s === "throttle_triggered") throw new ProviderError("The verification service is busy.", false);
    if (/credit/.test(lower(body.message))) throw new ProviderError("The verification service account has no credits left.", true);
    throw new ProviderError("The verification service reported an error.", false);
  }
  const r = lower(body.result);
  if (r === "valid") return { result: "valid", detail: DETAIL.valid };
  if (r === "catchall" || r === "unknown") return { result: "risky", detail: r === "unknown" ? "The address could not be confirmed right now." : DETAIL.risky };
  if (r === "disposable") return { result: "invalid", detail: "The address uses a throwaway email service." };
  if (r === "invalid") return { result: "invalid", detail: DETAIL.invalid };
  throw new ProviderError("The verification service sent an unexpected answer.", false);
}
