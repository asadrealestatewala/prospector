import "server-only";
import { getPlainSetting, getSecret } from "@/lib/integrations/settings-store";
import type { IntegrationId } from "@/lib/integrations/catalog";

export type TestResult = { ok: boolean; message: string };

const TIMEOUT_MS = 10_000;

async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON; keep the text.
  }
  return { status: res.status, body };
}

function providerMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error as Record<string, unknown> | string | undefined;
    if (typeof err === "string") return err;
    if (err && typeof err.message === "string") return err.message;
    if (typeof b.message === "string") return b.message;
  }
  return typeof body === "string" ? body.slice(0, 160) : "No details returned.";
}

/**
 * Google Places (New) text search with only the place ID field, which Google bills as the
 * free "IDs only" tier. One call, no data stored.
 */
async function testGooglePlaces(): Promise<TestResult> {
  const apiKey = await getSecret("google.places_api_key");
  if (!apiKey) return { ok: false, message: "Add the Places API key first." };
  const { status, body } = await call("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify({ textQuery: "school in Lahore", pageSize: 1 }),
  });
  if (status === 200) return { ok: true, message: "Connected. Google Places answered a test search." };
  return { ok: false, message: `Google refused the key (${status}): ${providerMessage(body)}` };
}

/** One Custom Search query (uses one of the free daily queries). */
async function testGoogleSearch(): Promise<TestResult> {
  const apiKey = await getSecret("google.custom_search_api_key");
  const cx = await getPlainSetting<string>("google.custom_search_cx");
  if (!apiKey) return { ok: false, message: "Add the Custom Search API key first." };
  if (!cx) return { ok: false, message: "Add the search engine ID (cx) first." };
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.search = new URLSearchParams({ key: apiKey, cx, q: "school Lahore", num: "1" }).toString();
  const { status, body } = await call(url.toString(), { method: "GET" });
  if (status === 200) return { ok: true, message: "Connected. Custom Search answered a test query." };
  return { ok: false, message: `Google refused the request (${status}): ${providerMessage(body)}` };
}

/** Lists domains, which needs a full-access key. A sending-only key is reported as valid but restricted. */
async function testResend(): Promise<TestResult> {
  const apiKey = await getSecret("resend.api_key");
  if (!apiKey) return { ok: false, message: "Add the Resend API key first." };
  const { status, body } = await call("https://api.resend.com/domains", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (status === 200) {
    const domains = (body as { data?: { name: string; status: string }[] })?.data ?? [];
    const summary = domains.length
      ? domains.map((d) => `${d.name} (${d.status})`).join(", ")
      : "no sending domains added yet";
    return { ok: true, message: `Connected. Domains: ${summary}.` };
  }
  const msg = providerMessage(body);
  if (status === 401 && /restricted/i.test(msg)) {
    return { ok: true, message: "Key is valid but limited to sending, so domains could not be listed." };
  }
  return { ok: false, message: `Resend refused the key (${status}): ${msg}` };
}

/** BotLinkd documents only send endpoints, so the test sends one short text to the Admin's own number. */
async function testBotlinkd(target?: string): Promise<TestResult> {
  const appKey = await getSecret("botlinkd.app_key");
  const authKey = await getSecret("botlinkd.auth_key");
  if (!appKey || !authKey) return { ok: false, message: "Add both the app key and the auth key first." };
  const to = (target ?? "").replace(/\D/g, "").replace(/^0(3\d{9})$/, "92$1");
  if (!/^\d{10,15}$/.test(to)) return { ok: false, message: "Enter your own WhatsApp number, for example 923001234567." };
  const form = new FormData();
  form.set("appkey", appKey);
  form.set("authkey", authKey);
  form.set("to", to);
  form.set("message", "Prospector connection test. You can ignore this message.");
  const { status, body } = await call("https://botlinkd.com/api/whatsapp/message", { method: "POST", body: form });
  const msg = providerMessage(body);
  const failed = status >= 400 || (body && typeof body === "object" && (body as Record<string, unknown>).error);
  if (!failed) return { ok: true, message: `Connected. BotLinkd accepted a test message to ${to}. ${msg}`.trim() };
  return { ok: false, message: `BotLinkd refused the request (${status}): ${msg}` };
}

export async function testIntegration(id: IntegrationId, target?: string): Promise<TestResult> {
  try {
    switch (id) {
      case "google_places":
        return await testGooglePlaces();
      case "google_search":
        return await testGoogleSearch();
      case "resend":
        return await testResend();
      case "botlinkd":
        return await testBotlinkd(target);
    }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      message: timeout
        ? "The service did not answer within 10 seconds. Check the server's internet access and try again."
        : "Could not reach the service. Check the key and the server's internet access, then try again.",
    };
  }
}
