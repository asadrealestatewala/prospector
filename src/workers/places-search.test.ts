import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const spend = vi.hoisted(() => ({ ok: true as boolean, message: null as string | null, costPkr: 2.5 }));
vi.mock("@/lib/engine/budget", () => ({
  GOOGLE_PROVIDER: "google_places",
  GOOGLE_ITEM: "text_search",
  checkGoogleSpend: vi.fn(async () => ({ ...spend, calls: 1, rateId: "rate-1", usedThisPeriod: 0, warning: null, remainingPkr: 100 })),
}));

import { processPlacesJob } from "./places-search";

type Row = Record<string, unknown>;

/** In-memory stand-in for the few supabase-js calls the worker makes. */
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
      lte(c: string, v: string) { filters.push((r) => String(r[c]) <= v); return api; },
      limit() { return api; },
      or(expr: string) {
        // Only the claim filter is used: status.eq.queued,and(status.eq.running,job_id.eq.X)
        const job = /job_id\.eq\.([^)]+)\)/.exec(expr)?.[1];
        filters.push((r) => r.status === "queued" || (r.status === "running" && r.job_id === job));
        return api;
      },
      run() {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (op === "update") rows.forEach((r) => Object.assign(r, patch));
        return { data: op === "update" && !returning ? null : rows.map((r) => ({ ...r })), error: null };
      },
      async single() { const r = api.run(); return { data: r.data?.[0] ?? null, error: null }; },
      async maybeSingle() { return api.single(); },
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

function page(names: string[], next: string | null) {
  return new Response(JSON.stringify({ places: names.map((n) => ({ id: `p-${n}`, displayName: { text: n }, websiteUri: `https://${n}.pk` })), nextPageToken: next }), { status: 200 });
}

describe("places-search worker", () => {
  let tables: Record<string, Row[]>;
  const saved = new Set<string>();

  beforeEach(() => {
    spend.ok = true;
    spend.message = null;
    saved.clear();
    tables = {
      searches: [{ id: "s1", name: "Schools", product: "classwell", keywords: ["school", "academy"], options: { maxPerCity: 60 }, status: "queued", started_at: null }],
      search_cities: [{ id: "c1", search_id: "s1", city: "Lahore", area: null, radius_m: null, latitude: null, longitude: null, status: "queued", keyword_index: 0, next_page_token: null, found_count: 0, saved_count: 0, duplicate_count: 0, api_calls: 0, cost_pkr: 0, job_id: null }],
    };
  });

  const rpcs = {
    save_place_lead: (a: Row) => {
      const id = (a.p as { place_id: string }).place_id;
      if (saved.has(id)) return "duplicate";
      saved.add(id);
      return "inserted";
    },
  };

  it("pages through every keyword, saves leads, counts duplicates and charges each call", async () => {
    const { db, calls } = fakeDb(tables, rpcs);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], "t2"))
      .mockResolvedValueOnce(page(["c"], null))
      .mockResolvedValueOnce(page(["a", "d"], null)); // second keyword finds "a" again
    const result = await processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl });

    expect(result).toContain("done");
    const city = tables.search_cities[0];
    expect(city).toMatchObject({ status: "done", saved_count: 4, duplicate_count: 1, found_count: 5, api_calls: 3, keyword_index: 2 });
    expect(calls.filter((c) => c.rpc === "record_api_usage")).toHaveLength(3);
    expect(calls.some((c) => c.rpc === "finish_search_if_complete")).toBe(true);
    expect(tables.searches[0].status).toBe("running");
  });

  it("stops at the per-city limit", async () => {
    tables.searches[0].options = { maxPerCity: 3 };
    const { db } = fakeDb(tables, rpcs);
    const fetchImpl = vi.fn().mockResolvedValueOnce(page(["a", "b", "c", "d", "e"], "t2"));
    await processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(tables.search_cities[0]).toMatchObject({ status: "done", saved_count: 3 });
  });

  it("pauses the whole search when the budget would be passed, before calling Google", async () => {
    spend.ok = false;
    spend.message = "Budget used up";
    tables.search_cities.push({ ...tables.search_cities[0], id: "c2", city: "Multan" });
    const { db } = fakeDb(tables, rpcs);
    const fetchImpl = vi.fn();
    const r = await processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl });
    expect(r).toBe("paused: budget");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tables.searches[0]).toMatchObject({ status: "paused", error: "Budget used up" });
    expect(tables.search_cities[1].status).toBe("paused");
  });

  it("does nothing when the city was already claimed by another job", async () => {
    tables.search_cities[0].status = "running";
    tables.search_cities[0].job_id = "other";
    const { db } = fakeDb(tables, rpcs);
    const fetchImpl = vi.fn();
    expect(await processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl })).toContain("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("carries on from the saved page after a retry", async () => {
    Object.assign(tables.search_cities[0], { status: "running", job_id: "j1", keyword_index: 1, next_page_token: "tok" });
    const { db } = fakeDb(tables, rpcs);
    const fetchImpl = vi.fn().mockResolvedValueOnce(page(["z"], null));
    await processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.pageToken).toBe("tok");
    expect(body.textQuery).toContain("academy");
    expect(tables.search_cities[0].status).toBe("done");
  });

  it("stops before the next page when the search is paused", async () => {
    tables.searches[0].status = "paused";
    const { db } = fakeDb(tables, rpcs);
    const fetchImpl = vi.fn();
    expect(await processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl })).toContain("paused");
    expect(tables.search_cities[0].status).toBe("paused");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pauses the search and gives up when Google rejects the key", async () => {
    const { db } = fakeDb(tables, rpcs);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }));
    await expect(processPlacesJob({ id: "j1", data: { searchCityId: "c1" } }, { db, getApiKey: async () => "KEY", fetchImpl })).rejects.toThrow(/403/);
    expect(tables.search_cities[0].status).toBe("failed");
    expect(tables.searches[0].status).toBe("paused");
  });
});
