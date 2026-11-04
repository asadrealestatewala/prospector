import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const allowance = vi.hoisted(() => ({ ok: true as boolean, message: null as string | null, cap: 1000 as number | null, used: 0 }));
vi.mock("@/lib/engine/budget", () => ({
  checkEmailAllowance: vi.fn(async () => ({ ...allowance, warning: null, remaining: Math.max(0, (allowance.cap ?? 0) - allowance.used), period: { start: "2026-11-01", end: "2026-11-30" } })),
}));

import { dispatchEmailCampaigns, processEmailJob } from "./email-send";

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: Row) => unknown> = {}) {
  const calls: { rpc: string; args: Row }[] = [];
  function builder(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    let returning = false;
    const api = {
      select() { returning = true; return api; },
      update(p: Row) { op = "update"; patch = p; return api; },
      insert(p: Row) { op = "insert"; (tables[table] ??= []).push(p); return api; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return api; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return api; },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return api; },
      lte(c: string, v: string) { filters.push((r) => String(r[c]) <= v); return api; },
      order() { return api; },
      limit() { return api; },
      or(expr: string) {
        const m = /(\w+)\.is\.null,\w+\.eq\.(.+)$/.exec(expr);
        if (m) filters.push((r) => r[m[1]] == null || r[m[1]] === m[2]);
        return api;
      },
      run() {
        if (op === "insert") return { data: null, error: null };
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (op === "update") rows.forEach((r) => Object.assign(r, patch));
        return { data: op === "update" && !returning ? null : rows.map((r) => ({ ...r })), error: null };
      },
      async maybeSingle() { const r = api.run(); return { data: r.data?.[0] ?? null, error: null }; },
      then(res: (v: unknown) => void) { res(api.run()); },
    };
    return api;
  }
  const db = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: Row) => {
      calls.push({ rpc: name, args });
      return { data: rpcs[name] ? rpcs[name](args) : null, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const key = randomBytes(32);

describe("email-send worker", () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    Object.assign(allowance, { ok: true, message: null, cap: 1000, used: 0 });
    tables = {
      campaign_recipients: [{ id: "6f1c2a9e-4b7d-4c1e-9a3f-2d5e8b7c6a10", campaign_id: "c1", lead_id: "l1", contact_id: "e1", address: "info@school.pk", status: "queued", job_id: null }],
      campaigns: [{ id: "c1", status: "sending", product: "classwell", language: "en", subject_snapshot: "Hello {{business_name}}", body_snapshot: "<p>Fees for {{business_name}}: {{product_price}}</p>", sender_id: "s1" }],
      lead_contacts: [{ id: "e1", consent_state: "unknown", verification: "valid" }],
      email_senders: [{ id: "s1", from_name: "Asad", from_email: "asad@outreach.pk", reply_to: "asad@classwell.pk", is_active: true, warmup_started_on: null, domain: "outreach.pk" }],
      leads: [{ id: "l1", name: "Iqra School", city: "Lahore", product: "classwell" }],
      settings: [{ key: "branding.email_footer", value: "Classwell, Lahore" }, { key: "products.price_lines", value: { classwell: "PKR 20 per student" } }],
      audit_log: [],
    };
  });
  const job = (attemptsMade = 0) => ({ id: "j1", data: { recipientId: "6f1c2a9e-4b7d-4c1e-9a3f-2d5e8b7c6a10" }, attemptsMade, opts: { attempts: 3 } });
  const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 })) as unknown as typeof fetch;

  it("sends with the unsubscribe link and headers, then records it once", async () => {
    const { db, calls } = fakeDb(tables, { is_do_not_contact: () => false });
    const fetchImpl = ok();
    const r = await processEmailJob(job(), { db, getApiKey: async () => "re_key", encryptionKey: key, appUrl: "https://app.pk", fetchImpl });
    expect(r).toBe("sent");
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.subject).toBe("Hello Iqra School");
    expect(body.html).toContain("PKR 20 per student");
    expect(body.html).toMatch(/https:\/\/app\.pk\/u\/r[0-9a-f]{32}\./);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.reply_to).toBe("asad@classwell.pk");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("prospector-r-6f1c2a9e-4b7d-4c1e-9a3f-2d5e8b7c6a10");
    expect(calls.find((c) => c.rpc === "record_email_sent")?.args).toMatchObject({ p_job: "j1", p_provider_id: "re_1", p_period_start: "2026-11-01" });
    expect(tables.email_senders[0].warmup_started_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("checks do-not-contact at the moment of sending", async () => {
    const { db } = fakeDb(tables, { is_do_not_contact: () => true });
    const fetchImpl = ok();
    expect(await processEmailJob(job(), { db, getApiKey: async () => "k", encryptionKey: key, appUrl: "https://app.pk", fetchImpl })).toMatch(/do-not-contact/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tables.campaign_recipients[0]).toMatchObject({ status: "skipped", job_id: null });
  });

  it("puts the email back when the campaign was paused", async () => {
    tables.campaigns[0].status = "paused";
    const { db } = fakeDb(tables, { is_do_not_contact: () => false });
    expect(await processEmailJob(job(), { db, getApiKey: async () => "k", encryptionKey: key, appUrl: "https://app.pk", fetchImpl: ok() })).toMatch(/released/);
    expect(tables.campaign_recipients[0]).toMatchObject({ status: "pending", queued_at: null, job_id: null });
  });

  it("pauses the campaign when the cap is used up", async () => {
    Object.assign(allowance, { ok: false, message: "The Resend plan cap is used up." });
    const { db } = fakeDb(tables, { is_do_not_contact: () => false });
    expect(await processEmailJob(job(), { db, getApiKey: async () => "k", encryptionKey: key, appUrl: "https://app.pk", fetchImpl: ok() })).toBe("paused: cap or budget");
    expect(tables.campaigns[0]).toMatchObject({ status: "paused", paused_reason: "The Resend plan cap is used up." });
    expect(tables.campaign_recipients[0].status).toBe("pending");
  });

  it("pauses on an unverified domain and fails a bad address", async () => {
    const { db } = fakeDb(tables, { is_do_not_contact: () => false });
    const domain = vi.fn(async () => new Response(JSON.stringify({ name: "invalid_from_address", message: "domain" }), { status: 403 })) as unknown as typeof fetch;
    expect(await processEmailJob(job(), { db, getApiKey: async () => "k", encryptionKey: key, appUrl: "https://app.pk", fetchImpl: domain })).toBe("paused: provider");
    expect(tables.campaigns[0].status).toBe("paused");

    tables.campaigns[0].status = "sending";
    tables.campaign_recipients[0].status = "queued";
    const bad = vi.fn(async () => new Response(JSON.stringify({ name: "validation_error", message: "to" }), { status: 422 })) as unknown as typeof fetch;
    await expect(processEmailJob(job(), { db, getApiKey: async () => "k", encryptionKey: key, appUrl: "https://app.pk", fetchImpl: bad })).rejects.toThrow(/did not accept/);
    expect(tables.campaign_recipients[0].status).toBe("failed");
  });

  it("retries when Resend is busy", async () => {
    const { db } = fakeDb(tables, { is_do_not_contact: () => false });
    const busy = vi.fn(async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    await expect(processEmailJob(job(0), { db, getApiKey: async () => "k", encryptionKey: key, appUrl: "https://app.pk", fetchImpl: busy })).rejects.toThrow(/busy/);
    expect(tables.campaign_recipients[0].status).toBe("queued");
  });
});

describe("email dispatcher", () => {
  it("queues only what the window, gap and warm-up allow", async () => {
    const tables: Record<string, Row[]> = {
      campaigns: [{ id: "c1", channel: "email", status: "sending", product: "classwell", daily_limit: 100, send_window_start: "09:00:00", send_window_end: "18:00:00", gap_seconds: 5, next_send_at: null, sender_id: "s1", started_at: "x" }],
      email_senders: [{ id: "s1", from_name: "A", from_email: "a@o.pk", reply_to: null, is_active: true, warmup_started_on: null, domain: "o.pk" }],
      settings: [],
      campaign_recipients: [],
      audit_log: [],
    };
    const stats = { campaign_today: 0, domain_today: 18, total_today: 18, remaining: 50, pending: 50 };
    const { db, calls } = fakeDb(tables, {
      email_send_stats: () => stats,
      claim_email_recipients: (a) => Array.from({ length: Number(a.p_limit) }, (_, i) => ({ id: `r${i}`, queued_at: "2026-11-04T05:00:00Z" })),
    });
    const enqueue = vi.fn(async (_rows: { id: string; queuedAt: string; delayMs: number }[]) => {});
    // 10:00 in Pakistan; warm-up day 1 allows 20 and 18 already went today, so 2 are left.
    const n = await dispatchEmailCampaigns(db, enqueue, new Date("2026-11-04T05:00:00Z"));
    expect(n).toBe(2);
    expect(calls.find((c) => c.rpc === "claim_email_recipients")?.args.p_limit).toBe(2);
    expect(enqueue.mock.calls[0][0]).toEqual([
      { id: "r0", queuedAt: "2026-11-04T05:00:00Z", delayMs: 0 },
      { id: "r1", queuedAt: "2026-11-04T05:00:00Z", delayMs: 5000 },
    ]);
    expect(tables.campaigns[0].next_send_at).toBe("2026-11-04T05:00:10.000Z");

    // Outside the sending hours nothing is queued.
    expect(await dispatchEmailCampaigns(db, enqueue, new Date("2026-11-04T15:00:00Z"))).toBe(0);
  });

  it("finishes a campaign with nothing left and pauses all when the cap is blocked", async () => {
    const tables: Record<string, Row[]> = {
      campaigns: [{ id: "c1", channel: "email", status: "sending", product: "classwell", sender_id: "s1" }],
      settings: [],
      audit_log: [],
    };
    const { db } = fakeDb(tables, { email_send_stats: () => ({ campaign_today: 0, domain_today: 0, total_today: 0, remaining: 0, pending: 0 }) });
    await dispatchEmailCampaigns(db, vi.fn(), new Date("2026-11-04T05:00:00Z"));
    expect(tables.campaigns[0].status).toBe("done");

    tables.campaigns[0].status = "sending";
    Object.assign(allowance, { ok: false, message: "The Resend plan cap is not set." });
    await dispatchEmailCampaigns(db, vi.fn(), new Date("2026-11-04T05:00:00Z"));
    expect(tables.campaigns[0]).toMatchObject({ status: "paused", paused_reason: "The Resend plan cap is not set." });
    expect(tables.audit_log).toHaveLength(1);
  });
});
