import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pkToday } from "@/lib/utils";
import { CostsScreen, type BudgetRow, type ChangeRow, type PlanRow, type RateRow } from "./costs-screen";

export const metadata: Metadata = { title: "Costs" };

export default async function CostsPage() {
  await requireScreen("costs");
  const supabase = await createSupabaseServerClient();
  const today = pkToday();
  const month = `${today.slice(0, 7)}-01`;
  const [plans, rates, budgets, changes, users, msgCosts, apiCosts] = await Promise.all([
    supabase.from("cost_plans").select("*").order("kind").order("provider"),
    supabase.from("cost_rates").select("*").order("provider").order("item").order("effective_from", { ascending: false }),
    supabase.from("budgets").select("*").order("created_at"),
    supabase.from("cost_change_log").select("id, table_name, row_id, action, old_values, new_values, changed_by, changed_at").order("changed_at", { ascending: false }).limit(200),
    supabase.from("users").select("id, email"),
    supabase.from("message_costs").select("product, cost_pkr").gte("day", month),
    supabase.from("api_usage").select("cost_pkr").gte("day", month),
  ]);
  const byProduct: Record<string, number> = { classwell: 0, vetlin: 0, postwala: 0 };
  let usagePkr = 0;
  for (const r of msgCosts.data ?? []) {
    byProduct[r.product] = (byProduct[r.product] ?? 0) + Number(r.cost_pkr);
    usagePkr += Number(r.cost_pkr);
  }
  for (const r of apiCosts.data ?? []) usagePkr += Number(r.cost_pkr);
  const emails = new Map((users.data ?? []).map((u: { id: string; email: string }) => [u.id, u.email]));
  return (
    <CostsScreen
      today={today}
      month={month}
      plans={(plans.data ?? []) as PlanRow[]}
      rates={(rates.data ?? []) as RateRow[]}
      budgets={(budgets.data ?? []) as BudgetRow[]}
      changes={((changes.data ?? []) as Omit<ChangeRow, "changed_by_email">[]).map((c) => ({ ...c, changed_by_email: c.changed_by ? emails.get(c.changed_by) ?? null : null }))}
      usagePkr={usagePkr}
      spendByProduct={byProduct}
    />
  );
}
