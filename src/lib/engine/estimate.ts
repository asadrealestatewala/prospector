/**
 * Search size and cost estimates (SRS screen 3, step 5). Pure functions so the app, the worker
 * and the tests share one calculation. Prices always come from cost_rates; nothing is hard-coded.
 */

/** Google returns up to 20 places per page and at most 60 per query. */
export const PAGE_SIZE = 20;
export const MAX_RESULTS_PER_QUERY = 60;

export type SearchShape = {
  /** One entry per city or city area that becomes its own search row. */
  locations: number;
  keywords: number;
  maxPerCity: number;
};

/** Upper bound of text-search calls: every location and keyword, paged until the per-city limit. */
export function estimateCalls({ locations, keywords, maxPerCity }: SearchShape): number {
  if (locations <= 0 || keywords <= 0 || maxPerCity <= 0) return 0;
  const perQuery = Math.min(maxPerCity, MAX_RESULTS_PER_QUERY);
  const pages = Math.ceil(perQuery / PAGE_SIZE);
  return locations * keywords * pages;
}

export type GoogleRate = {
  /** Price per call in the rate's own currency. Null means not set, which blocks the search. */
  rate: number | null;
  currency: "USD" | "PKR";
  /** Free calls per month (or day) before the paid rate applies. */
  freeAllowance: number | null;
};

/**
 * PKR cost of `calls` more calls when `usedThisPeriod` calls were already made.
 * Only calls above the free allowance are charged. Returns null when a figure is missing.
 */
export function googleCallCostPkr(calls: number, usedThisPeriod: number, rate: GoogleRate, usdToPkr: number | null): number | null {
  if (rate.rate === null) return null;
  const allowance = rate.freeAllowance ?? 0;
  const billableBefore = Math.max(0, usedThisPeriod - allowance);
  const billableAfter = Math.max(0, usedThisPeriod + calls - allowance);
  const billable = billableAfter - billableBefore;
  if (billable === 0) return 0;
  const perCall = rate.currency === "PKR" ? rate.rate : usdToPkr ? rate.rate * usdToPkr : null;
  if (perCall === null) return null;
  return Math.round(billable * perCall * 10_000) / 10_000;
}

export type BudgetLimit = {
  name: string;
  /** Budget amount already converted to PKR. */
  amountPkr: number;
  stopPct: number;
  warnPct: number;
  /** Spend so far this month in the budget's scope, in PKR. */
  spentPkr: number;
};

export type BudgetVerdict = {
  ok: boolean;
  /** Clear message for the user when blocked, or a warning when near the limit. */
  message: string | null;
  warning: string | null;
  /** Smallest remaining amount across the budgets that apply. */
  remainingPkr: number | null;
};

/** Checks a planned spend against every budget that applies (SRS 8.4: block before queuing). */
export function checkBudgets(costPkr: number, limits: BudgetLimit[]): BudgetVerdict {
  if (limits.length === 0) {
    return {
      ok: false,
      message: "No Google budget is set. An Admin must add one on the Costs screen before searches can run.",
      warning: null,
      remainingPkr: null,
    };
  }
  let remaining = Infinity;
  let warning: string | null = null;
  for (const b of limits) {
    const stopAt = (b.amountPkr * b.stopPct) / 100;
    const left = stopAt - b.spentPkr;
    remaining = Math.min(remaining, left);
    if (b.spentPkr + costPkr > stopAt) {
      return {
        ok: false,
        message: `This search would cost about PKR ${costPkr.toFixed(0)} but only PKR ${Math.max(0, left).toFixed(0)} is left in the "${b.name}" budget this month. Reduce cities, keywords or results per city, or ask an Admin to raise the budget.`,
        warning: null,
        remainingPkr: Math.max(0, left),
      };
    }
    if (b.spentPkr + costPkr >= (b.amountPkr * b.warnPct) / 100) {
      warning = `After this search the "${b.name}" budget will be over ${b.warnPct}% used.`;
    }
  }
  return { ok: true, message: null, warning, remainingPkr: Math.max(0, remaining) };
}
