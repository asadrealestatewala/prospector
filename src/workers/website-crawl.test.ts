import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractPage } from "@/lib/engine/crawl-extract";
import type { CrawlSiteResult } from "./crawl-site";
import { dispatchCrawls, processCrawlJob, ROBOTS_BLOCKED } from "./website-crawl";

type Row = Record<string, unknown>;

/** In-memory stand-in for the supabase-js calls the crawl worker makes. */
function fakeDb(tables: Record<string, Row[]>, rpc: Record<string, (args: Row) => unknown>) {
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
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return api; },
      or(expr: string) {
        const job = /job_id\.eq\.([^)]+)\)/.exec(expr)?.[1];
        filters.push((r) => r.status === "queued" || (r.status === "running" && r.job_id === job));
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
  const db = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: Row) => {
      calls.push({ rpc: name, args });
      return { data: rpc[name]?.(args) ?? null, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const page = (url: string, html: string) => extractPage(html, url);
const ok = (pages: ReturnType<typeof page>[], extra: Partial<CrawlSiteResult> = {}): CrawlSiteResult => ({
  pages, failures: [], homepageError: null, skippedByRobots: [], ...extra,
});

describe("website-crawl worker", () => {
  let tables: Record<string, Row[]>;
  let saved: Row[];
  const rpcs = {
    save_crawl_result: (a: Row) => {
      const row = tables.crawl_jobs.find((r) => r.id === a.p_crawl_id && r.status === "running" && r.job_id === a.p_job_id);
      if (!row) return null;
      saved.push(a.p as Row);
      Object.assign(row, { status: "done" });
      return { emails: ((a.p as Row).emails as unknown[] | undefined)?.length ?? 0 };
    },
  };

  beforeEach(() => {
    saved = [];
    tables = {
      crawl_jobs: [{ id: "cj1", lead_id: "l1", url: "pawsvet.pk", status: "queued", job_id: null, retries: 0 }],
      leads: [{ id: "l1", product: "vetlin" }],
    };
  });

  it("crawls, merges every page and saves contacts, social links and hints", async () => {
    const { db } = fakeDb(tables, rpcs);
    const crawl = vi.fn(async () =>
      ok([
        page("http://pawsvet.pk/", `<title>Paws</title><meta name="description" content="Vet clinic for dogs and cats in Lahore."><a href="https://facebook.com/pawsvet">fb</a><p>Vaccination</p>`),
        page("http://pawsvet.pk/contact", `<p>hello@pawsvet.pk</p><p>WhatsApp 0300 1112223</p><a href="tel:03001112223">call</a><p>042 35710000</p>`),
      ], { skippedByRobots: ["http://pawsvet.pk/staff"] }),
    );
    const r = await processCrawlJob({ id: "j1", data: { crawlJobId: "cj1" }, attemptsMade: 0 }, { db, crawl, robots: async () => null });
    expect(r).toBe("done: 2 pages");
    expect(crawl).toHaveBeenCalledWith("http://pawsvet.pk/", expect.objectContaining({ maxPages: 6 }));
    const p = saved[0];
    expect((p.emails as { value: string }[]).map((e) => e.value)).toEqual(["hello@pawsvet.pk"]);
    expect((p.whatsapp as { value: string }[]).map((e) => e.value)).toEqual(["+923001112223"]);
    // The WhatsApp number is not saved again as a plain phone.
    expect((p.phones as { value: string }[]).map((e) => e.value)).toEqual(["+924235710000"]);
    expect(p.social).toEqual([{ platform: "facebook", url: "https://www.facebook.com/pawsvet", source_url: "http://pawsvet.pk/" }]);
    expect(p.description).toBe("Vet clinic for dogs and cats in Lahore.");
    expect(p.hints).toEqual({ services: ["Vaccination"], animals: ["Dogs", "Cats"] });
    expect(p.note).toMatch(/1 page\(s\) skipped because of the robots file/);
    expect(tables.crawl_jobs[0].status).toBe("done");
  });

  it("marks the crawl blocked when the robots file forbids the homepage", async () => {
    const { db } = fakeDb(tables, rpcs);
    const crawl = vi.fn();
    const r = await processCrawlJob({ id: "j1", data: { crawlJobId: "cj1" }, attemptsMade: 0 }, { db, crawl, robots: async () => ({ isAllowed: () => false }) });
    expect(r).toBe("blocked by robots");
    expect(crawl).not.toHaveBeenCalled();
    expect(tables.crawl_jobs[0]).toMatchObject({ status: "blocked_by_robots", error_reason: ROBOTS_BLOCKED });
  });

  it("retries a failed homepage, then marks it failed on the last attempt", async () => {
    const { db } = fakeDb(tables, rpcs);
    const crawl = vi.fn(async () => ok([], { homepageError: "The website took too long to respond." }));
    const deps = { db, crawl, robots: async () => null };
    await expect(processCrawlJob({ id: "j1", data: { crawlJobId: "cj1" }, attemptsMade: 0, opts: { attempts: 4 } }, deps)).rejects.toThrow(/too long/);
    expect(tables.crawl_jobs[0]).toMatchObject({ status: "running", error_reason: "The website took too long to respond.", retries: 0 });
    // BullMQ runs the same job again; it takes its crawl back.
    await expect(processCrawlJob({ id: "j1", data: { crawlJobId: "cj1" }, attemptsMade: 3, opts: { attempts: 4 } }, deps)).rejects.toThrow(/too long/);
    expect(tables.crawl_jobs[0]).toMatchObject({ status: "failed", retries: 3 });
    expect(crawl).toHaveBeenCalledTimes(2);
  });

  it("does not crawl a Facebook page given as the website", async () => {
    tables.crawl_jobs[0].url = "https://www.facebook.com/pawsvet/";
    const { db } = fakeDb(tables, rpcs);
    const crawl = vi.fn();
    expect(await processCrawlJob({ id: "j1", data: { crawlJobId: "cj1" }, attemptsMade: 0 }, { db, crawl, robots: async () => null })).toBe("done: social page");
    expect(crawl).not.toHaveBeenCalled();
    expect(saved[0].social).toEqual([{ platform: "facebook", url: "https://www.facebook.com/pawsvet", source_url: "https://www.facebook.com/pawsvet/" }]);
  });

  it("skips a crawl another job already holds", async () => {
    Object.assign(tables.crawl_jobs[0], { status: "running", job_id: "other" });
    const { db } = fakeDb(tables, rpcs);
    const crawl = vi.fn();
    expect(await processCrawlJob({ id: "j1", data: { crawlJobId: "cj1" }, attemptsMade: 0 }, { db, crawl, robots: async () => null })).toContain("skipped");
    expect(crawl).not.toHaveBeenCalled();
  });

  it("dispatches queued crawls and releases them if Redis is down", async () => {
    const { db } = fakeDb(tables, { take_crawls_to_enqueue: () => [{ id: "cj1", enqueued_at: "2026-11-06T10:00:00Z" }] });
    const enqueue = vi.fn(async () => undefined);
    expect(await dispatchCrawls(db, enqueue)).toBe(1);
    expect(enqueue).toHaveBeenCalledWith([{ id: "cj1", enqueuedAt: "2026-11-06T10:00:00Z" }]);
    tables.crawl_jobs[0].enqueued_at = "2026-11-06T10:00:00Z";
    await expect(dispatchCrawls(db, async () => { throw new Error("redis down"); })).rejects.toThrow(/redis/);
    expect(tables.crawl_jobs[0].enqueued_at).toBeNull();
  });
});
