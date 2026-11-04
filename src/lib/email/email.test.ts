import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEmail, fillVariables, htmlToText, sanitizeEmailHtml, variablesIn } from "./render";
import { makeUnsubscribeToken, readUnsubscribeToken } from "./unsubscribe";
import { formatFrom, parseResendEvent, resendFailure, sendWithResend, verifyResendSignature } from "./resend";
import { capPeriod, inSendWindow, pkClock, planBatch, readEmailLimits, warmupLimit } from "./limits";

describe("template variables", () => {
  it("fills values, uses fallbacks and escapes HTML", () => {
    const r = fillVariables("Hi {{contact_name|Principal Sahib}} at {{business_name}} {{city}}", { business_name: "A&B <School>", city: "" }, true);
    expect(r.text).toBe("Hi Principal Sahib at A&amp;B &lt;School&gt; ");
    expect(r.missing).toEqual(["city"]);
    expect(variablesIn("{{ business_name }}", "{{city|x}} {{business_name}}")).toEqual(["business_name", "city"]);
  });

  it("removes scripts, images and unsafe links from the body", () => {
    const clean = sanitizeEmailHtml('<p onclick="x">Hi<script>alert(1)</script><img src="x"><a href="javascript:alert(1)">a</a><a href="https://classwell.pk">b</a></p>');
    expect(clean).toBe('<p>Hi<a>a</a><a href="https://classwell.pk">b</a></p>');
  });

  it("always adds the unsubscribe footer, right to left for Urdu", () => {
    const e = buildEmail({ subject: "Hello\n{{business_name}}", bodyHtml: "<p>Salam</p>", values: { business_name: "Iqra" }, language: "ur", footer: "Classwell, Lahore", unsubscribeUrl: "https://app.pk/u/t" });
    expect(e.subject).toBe("Hello Iqra");
    expect(e.html).toContain('dir="rtl"');
    expect(e.html).toContain('href="https://app.pk/u/t"');
    expect(e.text).toContain("https://app.pk/u/t");
    expect(e.text).toContain("Classwell, Lahore");
  });

  it("turns HTML into readable text", () => {
    expect(htmlToText('<p>One &amp; two</p><ul><li>A</li></ul><p><a href="https://x.pk">site</a></p>')).toBe("One & two\n- A\n\nsite (https://x.pk)");
  });
});

describe("unsubscribe links", () => {
  const key = randomBytes(32);
  it("round-trips and refuses tampering", () => {
    const id = "6f1c2a9e-4b7d-4c1e-9a3f-2d5e8b7c6a10";
    const t = makeUnsubscribeToken({ kind: "r", id }, key);
    expect(readUnsubscribeToken(t, key)).toEqual({ kind: "r", id });
    expect(readUnsubscribeToken(t.replace(/^r/, "m"), key)).toBeNull();
    expect(readUnsubscribeToken(t, randomBytes(32))).toBeNull();
    expect(readUnsubscribeToken("garbage", key)).toBeNull();
  });
});

describe("Resend", () => {
  it("sends with an idempotency key and returns the id", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendWithResend("re_key", { from: formatFrom('Asad "A"', "a@x.pk"), to: "b@y.pk", subject: "s", html: "h", text: "t" }, "k-1", fetchImpl);
    expect(r.id).toBe("re_1");
    expect((seen?.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
    expect(JSON.parse(String(seen?.body)).from).toBe('"Asad A" <a@x.pk>');
  });

  it("sorts failures into retry, fail and pause", () => {
    expect(resendFailure(429, "rate_limit_exceeded", "").fatal).toBe(false);
    expect(resendFailure(500, "", "").fatal).toBe(false);
    expect(resendFailure(422, "validation_error", "bad to").pause).toBe(false);
    expect(resendFailure(422, "validation_error", "bad to").fatal).toBe(true);
    expect(resendFailure(403, "invalid_from_address", "").pause).toBe(true);
    expect(resendFailure(401, "invalid_api_key", "").pause).toBe(true);
    expect(resendFailure(429, "monthly_quota_exceeded", "").pause).toBe(true);
  });

  it("checks webhook signatures", () => {
    const secretBytes = randomBytes(24);
    const secret = `whsec_${secretBytes.toString("base64")}`;
    const body = '{"type":"email.delivered"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", secretBytes).update(`msg_1.${ts}.${body}`).digest("base64");
    expect(verifyResendSignature(secret, { id: "msg_1", timestamp: ts, signature: `v1,bad v1,${sig}` }, body)).toBe(true);
    expect(verifyResendSignature(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body + " ")).toBe(false);
    expect(verifyResendSignature(secret, { id: "msg_1", timestamp: String(Number(ts) - 600), signature: `v1,${sig}` }, body)).toBe(false);
    expect(verifyResendSignature(secret, { id: null, timestamp: ts, signature: `v1,${sig}` }, body)).toBe(false);
  });

  it("reads events", () => {
    expect(parseResendEvent({ type: "email.bounced", created_at: "2026-11-04T10:00:00Z", data: { email_id: "re_1", bounce: { type: "Permanent" } } })).toEqual({ type: "email.bounced", emailId: "re_1", at: "2026-11-04T10:00:00Z", bounceType: "Permanent" });
    expect(parseResendEvent("x")).toBeNull();
  });
});

describe("sending limits", () => {
  it("uses Pakistan time for the day and the sending hours", () => {
    const at = new Date("2026-11-04T19:30:00Z"); // 00:30 on 5 November in Pakistan
    expect(pkClock(at).date).toBe("2026-11-05");
    expect(pkClock(at).dayStart.toISOString()).toBe("2026-11-04T19:00:00.000Z");
    expect(inSendWindow(new Date("2026-11-04T04:00:00Z"), "09:00", "18:00")).toBe(true); // 09:00 PKT
    expect(inSendWindow(new Date("2026-11-04T13:00:00Z"), "09:00", "18:00")).toBe(false); // 18:00 PKT
    expect(inSendWindow(at, "22:00", "02:00")).toBe(true);
  });

  it("raises the daily limit on the warm-up schedule", () => {
    const w = readEmailLimits(null).warmup;
    expect(warmupLimit(w, null, "2026-11-04")).toBe(20);
    expect(warmupLimit(w, "2026-11-01", "2026-11-04")).toBe(40); // day 4
    expect(warmupLimit(w, "2026-10-01", "2026-11-04")).toBe(300);
  });

  it("queues only the emails due before the next tick, spaced by the gap", () => {
    const now = new Date("2026-11-04T05:00:00Z");
    expect(planBatch({ now, nextSendAt: null, gapSeconds: 60, tickSeconds: 15, allowed: 10 }).count).toBe(1);
    expect(planBatch({ now, nextSendAt: new Date(now.getTime() + 30_000), gapSeconds: 60, tickSeconds: 15, allowed: 10 }).count).toBe(0);
    expect(planBatch({ now, nextSendAt: null, gapSeconds: 5, tickSeconds: 15, allowed: 10 }).count).toBe(4);
    expect(planBatch({ now, nextSendAt: null, gapSeconds: 5, tickSeconds: 15, allowed: 2 }).count).toBe(2);
    expect(planBatch({ now, nextSendAt: null, gapSeconds: 0, tickSeconds: 15, allowed: 100 }).count).toBe(25);
    expect(planBatch({ now, nextSendAt: null, gapSeconds: 60, tickSeconds: 15, allowed: -3 }).count).toBe(0);
  });

  it("works out the plan period from the billing day", () => {
    expect(capPeriod(null, "2026-11-04")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(capPeriod(15, "2026-11-04")).toEqual({ start: "2026-10-15", end: "2026-11-14" });
    expect(capPeriod(31, "2026-02-28")).toEqual({ start: "2026-02-28", end: "2026-03-30" });
    expect(capPeriod(5, "2026-01-02")).toEqual({ start: "2025-12-05", end: "2026-01-04" });
  });

  it("falls back to safe defaults for a broken setting", () => {
    expect(readEmailLimits({ daily_cap: -1 }).daily_cap).toBe(300);
    expect(readEmailLimits({ daily_cap: 500 }).daily_cap).toBe(500);
  });
});
