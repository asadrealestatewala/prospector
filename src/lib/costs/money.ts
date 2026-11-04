/** Currency helpers for the Costs screen. The USD to PKR rate always comes from cost_rates. */
export type Currency = "PKR" | "USD";

/** Converts an amount to PKR. Returns null when a USD amount has no exchange rate set. */
export function toPkr(amount: number | null, currency: Currency, usdToPkr: number | null): number | null {
  if (amount === null) return null;
  if (currency === "PKR") return amount;
  return usdToPkr ? amount * usdToPkr : null;
}

export function fromPkr(amountPkr: number | null, target: Currency, usdToPkr: number | null): number | null {
  if (amountPkr === null) return null;
  if (target === "PKR") return amountPkr;
  return usdToPkr ? amountPkr / usdToPkr : null;
}

export type Plan = { monthly_price: number | null; currency: Currency; is_active: boolean };
export type Budget = { amount: number; currency: Currency; is_active: boolean; month: string | null; product: string | null; channel: string | null; provider: string | null };

export type Summary = {
  usagePkr: number;
  fixedPkr: number;
  totalPkr: number;
  budgetPkr: number | null;
  usedPct: number | null;
  /** Prices or budgets that could not be counted because a figure or the exchange rate is missing. */
  missing: string[];
};

/** Month-to-date spend: usage costs plus active plan fees, against the overall monthly budgets. */
export function summarise(input: {
  usagePkr: number;
  plans: Plan[];
  budgets: Budget[];
  usdToPkr: number | null;
  month: string; // YYYY-MM-01
}): Summary {
  const missing: string[] = [];
  let fixedPkr = 0;
  for (const p of input.plans.filter((p) => p.is_active)) {
    if (p.monthly_price === null) {
      missing.push("plan price");
      continue;
    }
    const v = toPkr(Number(p.monthly_price), p.currency, input.usdToPkr);
    if (v === null) missing.push("USD to PKR rate");
    else fixedPkr += v;
  }
  // Overall budgets are those not narrowed to one provider, product or channel.
  const overall = input.budgets.filter(
    (b) => b.is_active && !b.provider && !b.product && !b.channel && (b.month === null || b.month === input.month),
  );
  const monthSpecific = overall.filter((b) => b.month === input.month);
  const applicable = monthSpecific.length ? monthSpecific : overall;
  let budgetPkr: number | null = applicable.length ? 0 : null;
  for (const b of applicable) {
    const v = toPkr(Number(b.amount), b.currency, input.usdToPkr);
    if (v === null) missing.push("USD to PKR rate");
    else budgetPkr = (budgetPkr ?? 0) + v;
  }
  const totalPkr = input.usagePkr + fixedPkr;
  return {
    usagePkr: input.usagePkr,
    fixedPkr,
    totalPkr,
    budgetPkr,
    usedPct: budgetPkr ? (totalPkr / budgetPkr) * 100 : null,
    missing: Array.from(new Set(missing)),
  };
}

const HIDDEN = new Set(["id", "created_at", "updated_at", "created_by"]);

/** Fields that differ between two versions of a row, for the change history. */
export function changedFields(oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})]);
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const k of keys) {
    if (HIDDEN.has(k)) continue;
    const a = oldV?.[k] ?? null;
    const b = newV?.[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, from: a, to: b });
  }
  return out;
}
