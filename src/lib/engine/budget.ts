import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBudgets, googleCallCostPkr, type BudgetLimit, type BudgetVerdict, type GoogleRate } from "@/lib/engine/estimate";
import { toPkr, type Currency } from "@/lib/costs/money";
import type { Product } from "@/components/ui/chips";
import { capPeriod } from "@/lib/email/limits";

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

export const VERIFY_PROVIDER = "email_verification";
export const VERIFY_ITEM = "check";

export type SpendCheck = GoogleSpendCheck;

type Paid = {
  provider: string;
  item: string;
  /** Used in messages, for example "Google Places price per call". */
  priceLabel: string;
  /** What is blocked while the price is missing, for example "searches can run". */
  blocked: string;
};

const GOOGLE: Paid = { provider: GOOGLE_PROVIDER, item: GOOGLE_ITEM, priceLabel: "Google Places price per call", blocked: "searches can run" };
const VERIFY: Paid = { provider: VERIFY_PROVIDER, item: VERIFY_ITEM, priceLabel: "email verification price per check", blocked: "emails can be verified" };

export function checkGoogleSpend(db: SupabaseClient, product: Product, calls: number): Promise<GoogleSpendCheck> {
  return checkApiSpend(db, GOOGLE, product, calls);
}

/** The same check for paid email verification (SRS 8.4: prices and budgets read at the moment of use). */
export function checkVerifySpend(db: SupabaseClient, product: Product | null, checks: number): Promise<SpendCheck> {
  return checkApiSpend(db, VERIFY, product, checks);
}

async function checkApiSpend(db: SupabaseClient, paid: Paid, product: Product | null, calls: number): Promise<SpendCheck> {
  const today = pkDate();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [{ data: rateRow }, { data: fxRow }] = await Promise.all([
    db.rpc("rate_on", { p_provider: paid.provider, p_item: paid.item, p_country: "PK", p_on: today }),
    db.rpc("rate_on", { p_provider: "fx", p_item: "usd_to_pkr", p_country: "PK", p_on: today }),
  ]);
  const rate = (Array.isArray(rateRow) ? rateRow[0] : rateRow) as
    | { id: string | null; rate: number | null; currency: Currency; free_allowance: number | null; allowance_period: "day" | "month" | null }
    | null;
  const fx = (Array.isArray(fxRow) ? fxRow[0] : fxRow) as { rate: number | null } | null;
  const usdToPkr = fx?.rate != null ? Number(fx.rate) : null;

  const base = { calls, costPkr: null, rateId: rate?.id ?? null, usedThisPeriod: 0, warning: null, remainingPkr: null };
  if (!rate?.id || rate.rate === null) {
    return { ...base, ok: false, message: `The ${paid.priceLabel} is not set. An Admin must enter it on the Costs screen before ${paid.blocked}.` };
  }
  if (rate.currency === "USD" && usdToPkr === null) {
    return { ...base, ok: false, message: "The USD to PKR exchange rate is not set. An Admin must enter it on the Costs screen." };
  }

  const periodStart = rate.allowance_period === "day" ? today : monthStart;
  const { data: usage } = await db
    .from("api_usage")
    .select("calls")
    .eq("provider", paid.provider)
    .eq("item", paid.item)
    .gte("day", periodStart);
  const usedThisPeriod = (usage ?? []).reduce((s, r) => s + Number(r.calls), 0);

  const googleRate: GoogleRate = { rate: Number(rate.rate), currency: rate.currency, freeAllowance: rate.free_allowance === null ? null : Number(rate.free_allowance) };
  const costPkr = googleCallCostPkr(calls, usedThisPeriod, googleRate, usdToPkr);
  if (costPkr === null) {
    return { ...base, usedThisPeriod, ok: false, message: `The ${paid.priceLabel} or the exchange rate is missing on the Costs screen.` };
  }

  const limits = await applicableLimits(db, paid.provider, product, monthStart, usdToPkr);
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

/** Budgets that cover this provider's spend for this product this month, with their spend so far. */
export async function applicableLimits(db: SupabaseClient, provider: string, product: Product | null, monthStart: string, usdToPkr: number | null): Promise<BudgetLimit[] | { error: string }> {
  const { data: budgets, error } = await db
    .from("budgets")
    .select("name, provider, product, channel, month, amount, currency, warn_pct, stop_pct")
    .eq("is_active", true)
    .is("channel", null)
    .or(`provider.is.null,provider.eq.${provider}`)
    .or(product ? `product.is.null,product.eq.${product}` : "product.is.null")
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

export type EmailAllowance = {
  ok: boolean;
  message: string | null;
  warning: string | null;
  cap: number | null;
  used: number;
  remaining: number;
  period: { start: string; end: string };
};

/**
 * Before any email is queued (SRS 8.4): the Resend plan cap for this period, read from the cost
 * tables, and any budget that covers Resend or all spend. Emails inside the plan have no per-email
 * charge (the plan fee is a fixed cost), so a budget blocks only once it has reached its stop level.
 */
export async function checkEmailAllowance(db: SupabaseClient, product: Product | null, count: number, now = new Date()): Promise<EmailAllowance> {
  const today = pkDate(now);
  const { data: plan } = await db
    .from("cost_plans")
    .select("usage_cap, billing_day")
    .eq("provider", "resend")
    .eq("kind", "plan")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const period = capPeriod(plan?.billing_day ?? null, today);
  const base = { warning: null, used: 0, remaining: 0, period };
  if (!plan || plan.usage_cap === null) {
    return { ...base, ok: false, cap: null, message: "The Resend plan cap is not set. An Admin must enter it on the Costs screen before emails can be sent." };
  }
  const cap = Number(plan.usage_cap);
  const { data: usedRaw } = await db.rpc("email_cap_usage", { p_period_start: period.start });
  const used = Number(usedRaw ?? 0);
  const remaining = Math.max(0, cap - used);
  if (count > remaining) {
    return {
      ...base, ok: false, cap, used, remaining,
      message: remaining === 0
        ? `The Resend plan cap of ${cap.toLocaleString("en-PK")} emails is used up for this period (until ${period.end}). Raise the plan on the Costs screen or wait for the next period.`
        : `This needs ${count.toLocaleString("en-PK")} emails but only ${remaining.toLocaleString("en-PK")} are left on the Resend plan this period (cap ${cap.toLocaleString("en-PK")}).`,
    };
  }
  const { data: fxRow } = await db.rpc("rate_on", { p_provider: "fx", p_item: "usd_to_pkr", p_country: "PK", p_on: today });
  const fx = (Array.isArray(fxRow) ? fxRow[0] : fxRow) as { rate: number | null } | null;
  const limits = await applicableLimits(db, "resend", product, `${today.slice(0, 7)}-01`, fx?.rate != null ? Number(fx.rate) : null);
  if ("error" in limits) return { ...base, ok: false, cap, used, remaining, message: limits.error };
  for (const b of limits) {
    if (b.spentPkr >= (b.amountPkr * b.stopPct) / 100) {
      return { ...base, ok: false, cap, used, remaining, message: `The "${b.name}" budget has reached its stop level this month, so emails are paused. An Admin can raise it on the Costs screen.` };
    }
  }
  const after = used + count;
  const warning = after >= cap * 0.8 ? `After this, ${Math.round((after / cap) * 100)}% of the Resend plan cap is used for this period.` : null;
  return { ok: true, message: null, warning, cap, used, remaining, period };
}
