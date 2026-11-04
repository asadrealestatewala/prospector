import { describe, expect, it } from "vitest";
import { changedFields, summarise, toPkr } from "./money";

describe("money", () => {
  it("never invents an exchange rate", () => {
    expect(toPkr(20, "USD", null)).toBeNull();
    expect(toPkr(20, "USD", 280)).toBe(5600);
    expect(toPkr(500, "PKR", null)).toBe(500);
  });

  it("adds plan fees and usage, flags missing figures", () => {
    const s = summarise({
      usagePkr: 1000,
      usdToPkr: null,
      month: "2026-11-01",
      plans: [
        { monthly_price: 20, currency: "USD", is_active: true },
        { monthly_price: 3000, currency: "PKR", is_active: true },
        { monthly_price: null, currency: "PKR", is_active: true },
        { monthly_price: 999, currency: "PKR", is_active: false },
      ],
      budgets: [{ amount: 10000, currency: "PKR", is_active: true, month: null, product: null, channel: null, provider: null }],
    });
    expect(s.totalPkr).toBe(4000);
    expect(s.budgetPkr).toBe(10000);
    expect(s.usedPct).toBe(40);
    expect(s.missing.sort()).toEqual(["USD to PKR rate", "plan price"]);
  });

  it("prefers a budget set for this month over the every-month budget", () => {
    const base = { currency: "PKR" as const, is_active: true, product: null, channel: null, provider: null };
    const s = summarise({
      usagePkr: 0,
      usdToPkr: 280,
      month: "2026-11-01",
      plans: [],
      budgets: [
        { ...base, amount: 10000, month: null },
        { ...base, amount: 25000, month: "2026-11-01" },
        { ...base, amount: 99999, month: "2026-12-01" },
        { ...base, amount: 5000, month: null, provider: "google_places" },
      ],
    });
    expect(s.budgetPkr).toBe(25000);
  });

  it("lists changed fields only", () => {
    expect(changedFields({ id: 1, rate: 13.5, label: "x", updated_at: "a" }, { id: 1, rate: 15, label: "x", updated_at: "b" })).toEqual([
      { field: "rate", from: 13.5, to: 15 },
    ]);
  });
});
