"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export type CostResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): CostResult {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") {
    return { ok: false, error: "A price for this item already starts on that date. Pick another date or edit that price." };
  }
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23514") {
    return { ok: false, error: "One of the values is out of range. Check percentages and amounts." };
  }
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

const money = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(0, "Amounts cannot be negative.").nullable());
const intOrNull = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).nullable());
const currency = z.enum(["PKR", "USD"]);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const optDate = z.preprocess((v) => (v === "" ? null : v), dateStr.nullable());

const planSchema = z.object({
  provider: z.string().trim().min(1, "Enter the provider.").max(60),
  kind: z.enum(["plan", "service_charge"]),
  plan_name: z.string().trim().min(1, "Enter a name.").max(120),
  monthly_price: money,
  currency,
  usage_cap: intOrNull,
  usage_unit: z.preprocess((v) => (v === "" ? null : v), z.string().max(40).nullable()),
  extra_usage_rate: money,
  billing_day: z.preprocess((v) => (v === "" || v === null ? null : Number(v)), z.number().int().min(1).max(31).nullable()),
  next_renewal_date: optDate,
  is_active: z.boolean(),
  notes: z.preprocess((v) => (v === "" ? null : v), z.string().max(500).nullable()),
});

export async function savePlan(id: string | null, input: Record<string, unknown>): Promise<CostResult> {
  try {
    const actor = await requireRole("admin");
    const v = planSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const res = id ? await supabase.from("cost_plans").update(v).eq("id", id).select("id").single() : await supabase.from("cost_plans").insert(v).select("id").single();
    if (res.error) throw res.error;
    await writeAudit(actor, id ? "cost.plan_changed" : "cost.plan_added", "cost_plan", res.data.id, { plan: v.plan_name, price: v.monthly_price, currency: v.currency, cap: v.usage_cap });
    revalidatePath("/costs");
    return { ok: true, message: `${v.plan_name} saved.` };
  } catch (e) {
    return fail(e);
  }
}

const rateSchema = z.object({
  provider: z.string().trim().min(1).max(60),
  item: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1, "Enter a label.").max(120),
  whatsapp_category: z.preprocess((v) => (v === "" ? null : v), z.enum(["marketing", "utility", "service", "authentication"]).nullable()),
  country: z.string().trim().min(1).max(3).transform((s) => s.toUpperCase()),
  unit: z.string().trim().min(1).max(20),
  rate: money,
  currency,
  free_allowance: intOrNull,
  allowance_period: z.preprocess((v) => (v === "" ? null : v), z.enum(["day", "month"]).nullable()),
  effective_from: dateStr,
  notes: z.preprocess((v) => (v === "" ? null : v), z.string().max(500).nullable()),
});

/** Corrects an existing price row (for a typo). Each change is kept in the change history. */
export async function updateRate(id: string, input: Record<string, unknown>): Promise<CostResult> {
  try {
    const actor = await requireRole("admin");
    const v = rateSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("cost_rates").update(v).eq("id", id);
    if (error) throw error;
    await writeAudit(actor, "cost.rate_changed", "cost_rate", id, { item: `${v.provider}/${v.item}`, rate: v.rate, currency: v.currency, effective_from: v.effective_from });
    revalidatePath("/costs");
    return { ok: true, message: `${v.label} updated.` };
  } catch (e) {
    return fail(e);
  }
}

/** Adds a new price from a date, keeping the old price for earlier reports. */
export async function addRateVersion(input: Record<string, unknown>): Promise<CostResult> {
  try {
    const actor = await requireRole("admin");
    const v = rateSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("cost_rates").insert({ ...v, created_by: actor.id }).select("id").single();
    if (error) throw error;
    await writeAudit(actor, "cost.rate_added", "cost_rate", data.id, { item: `${v.provider}/${v.item}`, rate: v.rate, currency: v.currency, effective_from: v.effective_from });
    revalidatePath("/costs");
    return { ok: true, message: `New price for ${v.label} starts on ${v.effective_from}.` };
  } catch (e) {
    return fail(e);
  }
}

const budgetSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(120),
    provider: z.preprocess((v) => (v === "" ? null : v), z.string().max(60).nullable()),
    product: z.preprocess((v) => (v === "" ? null : v), z.enum(["classwell", "vetlin", "postwala"]).nullable()),
    channel: z.preprocess((v) => (v === "" ? null : v), z.enum(["email", "whatsapp", "phone"]).nullable()),
    month: z.preprocess((v) => (v === "" || v === null ? null : `${String(v).slice(0, 7)}-01`), dateStr.nullable()),
    amount: z.preprocess((v) => Number(v), z.number({ message: "Enter an amount." }).min(0, "Amounts cannot be negative.")),
    currency,
    warn_pct: z.preprocess((v) => Number(v), z.number().gt(0).max(100)),
    stop_pct: z.preprocess((v) => Number(v), z.number().gt(0).max(200)),
    is_active: z.boolean(),
  })
  .refine((b) => b.warn_pct <= b.stop_pct, { message: "The warning percentage must be at or below the stop percentage.", path: ["warn_pct"] });

export async function saveBudget(id: string | null, input: Record<string, unknown>): Promise<CostResult> {
  try {
    const actor = await requireRole("admin");
    const v = budgetSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const res = id ? await supabase.from("budgets").update(v).eq("id", id).select("id").single() : await supabase.from("budgets").insert(v).select("id").single();
    if (res.error) throw res.error;
    await writeAudit(actor, id ? "cost.budget_changed" : "cost.budget_added", "budget", res.data.id, { name: v.name, amount: v.amount, currency: v.currency, warn_pct: v.warn_pct, stop_pct: v.stop_pct });
    revalidatePath("/costs");
    return { ok: true, message: `${v.name} saved.` };
  } catch (e) {
    return fail(e);
  }
}

export async function logCostExport(what: string, count: number) {
  const actor = await requireRole("admin");
  await writeAudit(actor, "export.csv", what, null, { rows: count });
}
