import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const spend = vi.hoisted(() => ({ ok: true as boolean, message: null as string | null }));
vi.mock("@/lib/engine/budget", () => ({
  VERIFY_PROVIDER: "email_verification",
  VERIFY_ITEM: "check",
  checkVerifySpend: vi.fn(async () => ({ ...spend, calls: 1, costPkr: 0.3, rateId: "rate-v", usedThisPeriod: 0, warning: null, remainingPkr: 100 })),
}));

import { NO_PROVIDER_DETAIL, processVerifyJob } from "./email-verify";

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const calls: { rpc: string; args: Row }[] = [];
  function builder(table: string) {
    let op: "select" | "update" = "select";
    let patch: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    let returning = false;
    const api = {
      select() { returning = true; return api; },
      update(p: Row) { op = "update"; patch = p; return api; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return api; },
      not(c: string, _op: string, _v: unknown) { filters.push((r) => r[c] !== null && r[c] !== undefined); return api; },
      or(expr: string) {
        const job = /verify_job_id\.eq\.(.+)$/.exec(expr)?.[1];
        filters.push((r) => r.verify_job_id == null || r.verify_job_id === job);
        return api;
      },
      run() {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (op === "update") rows.forEach((r) => Object.assign(r, patch));
        return { data: op === "update" && !returning ? null : rows.map((r) => ({ ...r })), error: null };
      },
      async maybeSingle() { const r = api.run(); return { data: r.data?.[0] ?? null, error: null }; },
      then(res: (v: unknown) => void) { res(api.run()); },
    };
    return api;
  }
  const db = { from: (t: string) => builder(t), rpc: async (name: string, args: Row) => { calls.push({ rpc: name, args }); return { data: null, error: null }; } };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("email-verify worker", () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    spend.ok = true;
    spend.message = null;
    tables = {
      lead_contacts: [{ id: "e1", lead_id: "l1", kind: "email", value: "info@school.pk", verification: "unverified", verify_requested_at: "t", verify_job_id: null }],
      leads: [{ id: "l1", product: "classwell" }],
    };
  });
  const job = (attemptsMade = 0) => ({ id: "j1", data: { contactId: "e1" }, attemptsMade, opts: { attempts: 3 } });
  const okMx = async () => ["mx.school.pk"];

  it("checks with the paid service, stores the result and charges one check", async () => {
    const { db, calls } = fakeDb(tables);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: "ok" }), { status: 200 }));
    const r = await processVerifyJob(job(), { db, resolveMx: okMx, getProvider: async () => ({ id: "millionverifier", apiKey: "K" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toBe("done: valid");
    expect(tables.lead_contacts[0]).toMatchObject({ verification: "valid", verify_requested_at: null, verify_job_id: null });
    expect(calls.find((c) => c.rpc === "record_api_usage")?.args).toMatchObject({ p_provider: "email_verification", p_product: "classwell", p_calls: 1, p_cost_pkr: 0.3 });
  });

  it("marks an address invalid from the free checks without paying", async () => {
    const { db, calls } = fakeDb(tables);
    const fetchImpl = vi.fn();
    await processVerifyJob(job(), { db, resolveMx: async () => [], getProvider: async () => ({ id: "zerobounce", apiKey: "K" }), fetchImpl });
    expect(tables.lead_contacts[0]).toMatchObject({ verification: "invalid", verification_detail: expect.stringMatching(/no mail server/) });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("leaves the address unverified when no service is connected", async () => {
    const { db } = fakeDb(tables);
    expect(await processVerifyJob(job(), { db, resolveMx: okMx, getProvider: async () => null })).toBe("done: free checks only");
    expect(tables.lead_contacts[0]).toMatchObject({ verification: "unverified", verification_detail: NO_PROVIDER_DETAIL, verify_requested_at: null });
  });

  it("does not call the service when the budget would be passed", async () => {
    spend.ok = false;
    spend.message = "The email verification price per check is not set.";
    const { db } = fakeDb(tables);
    const fetchImpl = vi.fn();
    expect(await processVerifyJob(job(), { db, resolveMx: okMx, getProvider: async () => ({ id: "neverbounce", apiKey: "K" }), fetchImpl })).toBe("stopped: budget");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tables.lead_contacts[0].verification_detail).toMatch(/price per check/);
  });

  it("retries a busy service and gives up on a wrong key", async () => {
    const { db } = fakeDb(tables);
    const busy = vi.fn(async () => new Response("{}", { status: 503 }));
    const deps = { db, resolveMx: okMx, getProvider: async () => ({ id: "zerobounce" as const, apiKey: "K" }), fetchImpl: busy as unknown as typeof fetch };
    await expect(processVerifyJob(job(0), deps)).rejects.toThrow(/busy/);
    expect(tables.lead_contacts[0].verify_requested_at).toBe("t");
    const refused = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(processVerifyJob(job(1), { ...deps, fetchImpl: refused as unknown as typeof fetch })).rejects.toThrow(/refused the API key/);
    expect(tables.lead_contacts[0]).toMatchObject({ verification: "unverified", verify_requested_at: null });
  });

  it("skips a contact that was not requested", async () => {
    tables.lead_contacts[0].verify_requested_at = null;
    const { db } = fakeDb(tables);
    expect(await processVerifyJob(job(), { db, resolveMx: okMx, getProvider: async () => null })).toContain("skipped");
  });
});
