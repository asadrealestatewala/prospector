import { describe, expect, it } from "vitest";
import { checkBudgets, estimateCalls, googleCallCostPkr } from "./estimate";

describe("estimateCalls", () => {
  it("pages up to the per-city limit, capped at 60 results per query", () => {
    expect(estimateCalls({ locations: 3, keywords: 2, maxPerCity: 60 })).toBe(18);
    expect(estimateCalls({ locations: 1, keywords: 1, maxPerCity: 25 })).toBe(2);
    expect(estimateCalls({ locations: 1, keywords: 1, maxPerCity: 500 })).toBe(3);
    expect(estimateCalls({ locations: 0, keywords: 3, maxPerCity: 60 })).toBe(0);
  });
});

describe("googleCallCostPkr", () => {
  const usd = { rate: 0.032, currency: "USD" as const, freeAllowance: 1000 };
  it("charges only calls above the free allowance", () => {
    expect(googleCallCostPkr(10, 0, usd, 280)).toBe(0);
    expect(googleCallCostPkr(10, 995, usd, 280)).toBeCloseTo(5 * 0.032 * 280);
    expect(googleCallCostPkr(10, 2000, usd, 280)).toBeCloseTo(10 * 0.032 * 280);
  });
  it("blocks when the rate or exchange rate is missing", () => {
    expect(googleCallCostPkr(10, 5000, { ...usd, rate: null }, 280)).toBeNull();
    expect(googleCallCostPkr(10, 5000, usd, null)).toBeNull();
  });
  it("uses PKR rates as they are", () => {
    expect(googleCallCostPkr(4, 0, { rate: 9, currency: "PKR", freeAllowance: null }, null)).toBe(36);
  });
});

describe("checkBudgets", () => {
  const b = { name: "Google monthly", amountPkr: 1000, stopPct: 100, warnPct: 80, spentPkr: 700 };
  it("blocks a search that would pass the stop level", () => {
    const v = checkBudgets(400, [b]);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("Google monthly");
    expect(v.remainingPkr).toBe(300);
  });
  it("warns near the limit and allows within it", () => {
    const v = checkBudgets(150, [b]);
    expect(v.ok).toBe(true);
    expect(v.warning).toContain("80%");
  });
  it("blocks when no budget is set", () => {
    expect(checkBudgets(0, []).ok).toBe(false);
  });
  it("uses the tightest of several budgets", () => {
    const v = checkBudgets(10, [b, { ...b, name: "All spend", amountPkr: 5000, spentPkr: 4995 }]);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("All spend");
  });
});
