import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBudgets, googleCallCostPkr, type BudgetLimit, type BudgetVerdict, type GoogleRate } from "@/lib/engine/estimate";
import { toPkr, type Currency } from "@/lib/costs/money";
import type { Product } from "@/components/ui/chips";

/**
 * Reads Google prices, usage and budgets at the moment of use (SRS 8.4) and decides whether a
 * planned number of text-search calls may go ahead. Used by the New Search screen before queuing
 * and by the worker before every page. Takes a service-role client; callers check roles first.
 */
export const GOOGLE_PROVIDER = "google_places";
export const GOOGLE_ITEM = "text_search";

export type GoogleSpendCheck = BudgetVerdict & {
  calls: number;
  costPkr: number | null;
  rateId: string | null;
  usedThisPeriod: number;
};

function pkDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}

export async function checkGoogleSpend(db: SupabaseClient, product: Product, calls: number): Promise<GoogleSpendCheck> {
  const today = pkDate();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [{ data: rateRow }, { data: fxRow }] = await Promise.all([
    db.rpc("rate_on", { p_provider: GOOGLE_PROVIDER, p_item: GOOGLE_ITEM, p_country: "PK", p_on: today }),
    db.rpc("rate_on", { p_provider: "fx", p_item: "usd_to_pkr", p_country: "PK", p_on: today }),
  ]);
  const rate = (Array.isArray(rateRow) ? rateRow[0] : rateRow) as
    | { id: string | null; rate: number | null; currency: Currency; free_allowance: number | null; allowance_period: "day" | "month" | null }
    | null;
  const fx = (Array.isArray(fxRow) ? fxRow[0] : fxRow) as { rate: number | null } | null;
  const usdToPkr = fx?.rate != null ? Number(fx.rate) : null;

  const base = { calls, costPkr: null, rateId: rate?.id ?? null, usedThisPeriod: 0, warning: null, remainingPkr: null };
  if (!rate?.id || rate.rate === null) {
    return { ...base, ok: false, message: "The Google Places price per call is not set. An Admin must enter it on the Costs screen before searches can run." };
  }
  if (rate.currency === "USD" && usdToPkr === null) {
    return { ...base, ok: false, message: "The USD to PKR exchange rate is not set. An Admin must enter it on the Costs screen." };
  }

  const periodStart = rate.allowance_period === "day" ? today : monthStart;
  const { data: usage } = await db
    .from("api_usage")
    .select("calls")
    .eq("provider", GOOGLE_PROVIDER)
    .eq("item", GOOGLE_ITEM)
    .gte("day", periodStart);
  const usedThisPeriod = (usage ?? []).reduce((s, r) => s + Number(r.calls), 0);

  const googleRate: GoogleRate = { rate: Number(rate.rate), currency: rate.currency, freeAllowance: rate.free_allowance === null ? null : Number(rate.free_allowance) };
  const costPkr = googleCallCostPkr(calls, usedThisPeriod, googleRate, usdToPkr);
  if (costPkr === null) {
    return { ...base, usedThisPeriod, ok: false, message: "A Google price or the exchange rate is missing on the Costs screen." };
  }

  const limits = await applicableLimits(db, product, monthStart, usdToPkr);
  if ("error" in limits) return { ...base, usedThisPeriod, costPkr, ok: false, message: limits.error };
  const verdict = checkBudgets(costPkr, limits);
  return { ...verdict, calls, costPkr, rateId: rate.id, usedThisPeriod };
}

type BudgetRow = {
  name: string;
  provider: string | null;
  product: Product | null;
  channel: string | null;
  month: string | null;
  amount: number;
  currency: Currency;
  warn_pct: number;
  stop_pct: number;
};

/** Budgets that cover Google spend for this product this month, with their spend so far. */
async function applicableLimits(db: SupabaseClient, product: Product, monthStart: string, usdToPkr: number | null): Promise<BudgetLimit[] | { error: string }> {
  const { data: budgets, error } = await db
    .from("budgets")
    .select("name, provider, product, channel, month, amount, currency, warn_pct, stop_pct")
    .eq("is_active", true)
    .is("channel", null)
    .or(`provider.is.null,provider.eq.${GOOGLE_PROVIDER}`)
    .or(`product.is.null,product.eq.${product}`)
    .or(`month.is.null,month.eq.${monthStart}`);
  if (error) return { error: "Could not read budgets." };
  const rows = (budgets ?? []) as BudgetRow[];

  const [{ data: api }, { data: msg }, { data: plans }] = await Promise.all([
    db.from("api_usage").select("provider, product, cost_pkr").gte("day", monthStart),
    db.from("message_costs").select("product, cost_pkr").gte("day", monthStart),
    db.from("cost_plans").select("monthly_price, currency").eq("is_active", true),
  ]);

  const limits: BudgetLimit[] = [];
  for (const b of rows) {
    const amountPkr = toPkr(Number(b.amount), b.currency, usdToPkr);
    if (amountPkr === null) return { error: `The "${b.name}" budget is in USD and the exchange rate is not set.` };
    const inScope = (p: Product | null) => !b.product || p === b.product;
    let spent = (api ?? [])
      .filter((r) => (!b.provider || r.provider === b.provider) && inScope(r.product as Product | null))
      .reduce((s, r) => s + Number(r.cost_pkr), 0);
    if (!b.provider) {
      spent += (msg ?? []).filter((r) => inScope(r.product as Product)).reduce((s, r) => s + Number(r.cost_pkr), 0);
      if (!b.product) {
        // The overall budget also carries the fixed monthly plan fees, as on the Costs screen.
        for (const p of plans ?? []) {
          const v = p.monthly_price === null ? 0 : toPkr(Number(p.monthly_price), p.currency as Currency, usdToPkr);
          spent += v ?? 0;
        }
      }
    }
    limits.push({ name: b.name, amountPkr, stopPct: Number(b.stop_pct), warnPct: Number(b.warn_pct), spentPkr: spent });
  }
  return limits;
}
