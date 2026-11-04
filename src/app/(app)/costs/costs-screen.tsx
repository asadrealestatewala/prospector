"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, History, Pencil, Plus, Receipt, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusChip } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SidePanel } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { changedFields, fromPkr, summarise, type Currency } from "@/lib/costs/money";
import { cn, formatMoney, formatNumber, formatPkDate, formatPkDateTime } from "@/lib/utils";
import { addRateVersion, logCostExport, saveBudget, savePlan, updateRate, type CostResult } from "./actions";

export type PlanRow = {
  id: string;
  provider: string;
  kind: "plan" | "service_charge";
  plan_name: string;
  monthly_price: number | null;
  currency: Currency;
  usage_cap: number | null;
  usage_unit: string | null;
  extra_usage_rate: number | null;
  billing_day: number | null;
  next_renewal_date: string | null;
  is_active: boolean;
  notes: string | null;
};

export type RateRow = {
  id: string;
  provider: string;
  item: string;
  label: string;
  whatsapp_category: string | null;
  country: string;
  unit: string;
  rate: number | null;
  currency: Currency;
  free_allowance: number | null;
  allowance_period: "day" | "month" | null;
  effective_from: string;
  notes: string | null;
};

export type BudgetRow = {
  id: string;
  name: string;
  provider: string | null;
  product: "classwell" | "vetlin" | "postwala" | null;
  channel: "email" | "whatsapp" | "phone" | null;
  month: string | null;
  amount: number;
  currency: Currency;
  warn_pct: number;
  stop_pct: number;
  is_active: boolean;
};

export type ChangeRow = {
  id: number;
  table_name: string;
  row_id: string;
  action: "insert" | "update" | "delete";
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_by: string | null;
  changed_by_email: string | null;
  changed_at: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  resend: "Resend",
  botlinkd: "BotLinkd",
  contabo: "Contabo",
  domain_dns: "Domain and DNS",
  social_api: "Social API",
  email_verification: "Email verification",
  meta_whatsapp: "Meta WhatsApp",
  google_places: "Google Places",
  google_search: "Google Custom Search",
  fx: "Exchange rate",
};
const providerLabel = (p: string | null) => (p ? PROVIDER_LABELS[p] ?? p : "All providers");
const TABLE_LABELS: Record<string, string> = { cost_plans: "Plan", cost_rates: "Price", budgets: "Budget" };

/** Latest version of each price that has started by today. */
function currentRates(rates: RateRow[], today: string) {
  const seen = new Map<string, RateRow>();
  for (const r of rates) {
    const k = `${r.provider}|${r.item}|${r.country}`;
    if (r.effective_from > today) continue;
    if (!seen.has(k)) seen.set(k, r);
  }
  return seen;
}

function formToObject(form: FormData, checkboxes: string[] = []) {
  const o: Record<string, unknown> = Object.fromEntries(form);
  for (const c of checkboxes) o[c] = form.get(c) === "on";
  return o;
}

function useSaver() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function save(fn: () => Promise<CostResult>, onOk: () => void) {
    setPending(true);
    setError(null);
    const res = await fn();
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    onOk();
    router.refresh();
  }
  return { pending, error, save, setError };
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="rounded-control bg-error-soft px-3 py-2 text-helper text-error" role="alert">
      {error}
    </p>
  ) : null;
}

/* ---------- Summary header ---------- */

function SummaryHeader({
  plans,
  budgets,
  usdToPkr,
  usagePkr,
  spendByProduct,
  month,
  currency,
  onCurrency,
}: {
  plans: PlanRow[];
  budgets: BudgetRow[];
  usdToPkr: number | null;
  usagePkr: number;
  spendByProduct: Record<string, number>;
  month: string;
  currency: Currency;
  onCurrency: (c: Currency) => void;
}) {
  const s = summarise({ usagePkr, plans, budgets, usdToPkr, month });
  const show = (pkr: number | null) => {
    const v = fromPkr(pkr, currency, usdToPkr);
    return v === null ? (pkr === null ? "Not set" : "Set USD rate") : formatMoney(v, currency);
  };
  const tiles = [
    { label: "Spend this month", value: show(s.totalPkr), sub: `${show(s.usagePkr)} usage + ${show(s.fixedPkr)} plans` },
    { label: "Total budget", value: show(s.budgetPkr), sub: s.budgetPkr === null ? "Add an overall monthly budget below" : "Overall monthly budget" },
    { label: "Classwell", value: show(spendByProduct.classwell ?? 0), sub: "Usage this month" },
    { label: "Vetlin", value: show(spendByProduct.vetlin ?? 0), sub: "Usage this month" },
    { label: "Postwala", value: show(spendByProduct.postwala ?? 0), sub: "Usage this month" },
  ];
  return (
    <Card className="mb-6">
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-helper text-fg-muted">Budget used</span>
              <span className="tabular text-body font-medium">{s.usedPct === null ? "No budget set" : `${s.usedPct.toFixed(1)}%`}</span>
            </div>
            <ProgressBar value={s.totalPkr} max={s.budgetPkr} label="Monthly budget used" />
          </div>
          <div role="radiogroup" aria-label="Currency" className="flex rounded-control border border-border p-1">
            {(["PKR", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={currency === c}
                onClick={() => onCurrency(c)}
                className={cn("h-7 rounded-[6px] px-3 text-helper font-medium text-fg-muted", currency === c && "bg-brand-600 text-white")}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="flex flex-col gap-1">
              <span className="text-helper text-fg-muted">{t.label}</span>
              <span className="tabular text-section font-semibold">{t.value}</span>
              <span className="text-helper text-fg-muted">{t.sub}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-helper text-fg-muted">
          <span>Cost per lead, demo and customer: shown once leads and demos exist (steps 2 and 8).</span>
          <span>
            USD to PKR: {usdToPkr ? <span className="tabular text-fg">{usdToPkr}</span> : <span className="text-warning">not set</span>} (edit it under Prices below)
          </span>
          {s.missing.length ? <span className="text-warning">Not counted yet: {s.missing.join(", ")}.</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}

/* ---------- Plans ---------- */

function PlanPanel({ plan, onClose }: { plan: PlanRow | "new"; onClose: () => void }) {
  const p = plan === "new" ? null : plan;
  const { pending, error, save } = useSaver();
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={p ? `Edit ${p.plan_name}` : "Add plan or service charge"} description="Prices here feed every cap and cost check.">
      <form id="plan-form" className="flex flex-col gap-4" action={(f) => save(() => savePlan(p?.id ?? null, formToObject(f, ["is_active"])), onClose)}>
        <FormError error={error} />
        <Field label="Name" htmlFor="plan_name">
          <Input id="plan_name" name="plan_name" defaultValue={p?.plan_name} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Provider" htmlFor="provider" hint="For example resend, botlinkd, contabo">
            <Input id="provider" name="provider" defaultValue={p?.provider} required />
          </Field>
          <Field label="Type" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue={p?.kind ?? "plan"}>
              <option value="plan">Usage plan</option>
              <option value="service_charge">Fixed service charge</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Monthly price" htmlFor="monthly_price" hint="Leave empty if not known yet">
            <Input id="monthly_price" name="monthly_price" type="number" step="0.01" min="0" defaultValue={p?.monthly_price ?? ""} className="tabular" />
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select id="currency" name="currency" defaultValue={p?.currency ?? "USD"}>
              <option>USD</option>
              <option>PKR</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Monthly cap" htmlFor="usage_cap" hint="Empty means no cap">
            <Input id="usage_cap" name="usage_cap" type="number" min="0" step="1" defaultValue={p?.usage_cap ?? ""} className="tabular" />
          </Field>
          <Field label="Cap unit" htmlFor="usage_unit" hint="emails, messages, requests">
            <Input id="usage_unit" name="usage_unit" defaultValue={p?.usage_unit ?? ""} />
          </Field>
        </div>
        <Field label="Cost per unit over the cap" htmlFor="extra_usage_rate" hint="In the plan currency">
          <Input id="extra_usage_rate" name="extra_usage_rate" type="number" step="0.000001" min="0" defaultValue={p?.extra_usage_rate ?? ""} className="tabular" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Billing day" htmlFor="billing_day">
            <Input id="billing_day" name="billing_day" type="number" min="1" max="31" defaultValue={p?.billing_day ?? ""} className="tabular" />
          </Field>
          <Field label="Next renewal" htmlFor="next_renewal_date">
            <Input id="next_renewal_date" name="next_renewal_date" type="date" defaultValue={p?.next_renewal_date ?? ""} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={p?.notes ?? ""} />
        </Field>
        <label className="flex items-center gap-3 text-body">
          <input type="checkbox" name="is_active" defaultChecked={p?.is_active ?? true} className="size-4 accent-[var(--brand-600)]" />
          Active (counted in monthly spend)
        </label>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>Save</Button>
        </div>
      </form>
    </SidePanel>
  );
}

/* ---------- Rates ---------- */

function RatePanel({ rate, mode, today, onClose }: { rate: RateRow; mode: "edit" | "new-version"; today: string; onClose: () => void }) {
  const { pending, error, save } = useSaver();
  return (
    <SidePanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === "edit" ? `Correct ${rate.label}` : `New price for ${rate.label}`}
      description={mode === "edit" ? "Use this to fix a typo. Reports that used this price will change." : "The old price stays for reports before the start date."}
    >
      <form
        className="flex flex-col gap-4"
        action={(f) => {
          const o = { ...formToObject(f), provider: rate.provider, item: rate.item, whatsapp_category: rate.whatsapp_category ?? "", country: rate.country, unit: rate.unit };
          return save(() => (mode === "edit" ? updateRate(rate.id, o) : addRateVersion(o)), onClose);
        }}
      >
        <FormError error={error} />
        <Field label="Label" htmlFor="label">
          <Input id="label" name="label" defaultValue={rate.label} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Price per ${rate.unit}`} htmlFor="rate" hint="Empty means not set, which blocks spend">
            <Input id="rate" name="rate" type="number" step="0.000001" min="0" defaultValue={rate.rate ?? ""} className="tabular" />
          </Field>
          <Field label="Currency" htmlFor="rate-currency">
            <Select id="rate-currency" name="currency" defaultValue={rate.currency}>
              <option>PKR</option>
              <option>USD</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Free allowance" htmlFor="free_allowance" hint={`Free ${rate.unit}s before charges`}>
            <Input id="free_allowance" name="free_allowance" type="number" min="0" step="1" defaultValue={rate.free_allowance ?? ""} className="tabular" />
          </Field>
          <Field label="Allowance period" htmlFor="allowance_period">
            <Select id="allowance_period" name="allowance_period" defaultValue={rate.allowance_period ?? ""}>
              <option value="">None</option>
              <option value="day">Per day</option>
              <option value="month">Per month</option>
            </Select>
          </Field>
        </div>
        <Field label="Effective from (Pakistan date)" htmlFor="effective_from">
          <Input id="effective_from" name="effective_from" type="date" required defaultValue={mode === "edit" ? rate.effective_from : today} />
        </Field>
        <Field label="Notes" htmlFor="rate-notes">
          <Textarea id="rate-notes" name="notes" defaultValue={rate.notes ?? ""} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>{mode === "edit" ? "Save correction" : "Add new price"}</Button>
        </div>
      </form>
    </SidePanel>
  );
}

/* ---------- Budgets ---------- */

function BudgetPanel({ budget, onClose }: { budget: BudgetRow | "new"; onClose: () => void }) {
  const b = budget === "new" ? null : budget;
  const { pending, error, save } = useSaver();
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={b ? `Edit ${b.name}` : "Add budget"} description="Searches and sends are blocked when the stop percentage is reached.">
      <form className="flex flex-col gap-4" action={(f) => save(() => saveBudget(b?.id ?? null, formToObject(f, ["is_active"])), onClose)}>
        <FormError error={error} />
        <Field label="Name" htmlFor="budget-name">
          <Input id="budget-name" name="name" defaultValue={b?.name} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Provider" htmlFor="budget-provider" hint="Empty for all">
            <Select id="budget-provider" name="provider" defaultValue={b?.provider ?? ""}>
              <option value="">All providers</option>
              {["google_places", "google_search", "meta_whatsapp", "resend", "botlinkd", "social_api", "email_verification"].map((p) => (
                <option key={p} value={p}>{providerLabel(p)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Product" htmlFor="budget-product" hint="Empty for all">
            <Select id="budget-product" name="product" defaultValue={b?.product ?? ""}>
              <option value="">All products</option>
              <option value="classwell">Classwell</option>
              <option value="vetlin">Vetlin</option>
              <option value="postwala">Postwala</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Channel" htmlFor="budget-channel" hint="Empty for all">
            <Select id="budget-channel" name="channel" defaultValue={b?.channel ?? ""}>
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </Select>
          </Field>
          <Field label="Month" htmlFor="budget-month" hint="Empty means every month">
            <Input id="budget-month" name="month" type="month" defaultValue={b?.month ? b.month.slice(0, 7) : ""} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount" htmlFor="budget-amount">
            <Input id="budget-amount" name="amount" type="number" step="0.01" min="0" required defaultValue={b?.amount ?? ""} className="tabular" />
          </Field>
          <Field label="Currency" htmlFor="budget-currency">
            <Select id="budget-currency" name="currency" defaultValue={b?.currency ?? "PKR"}>
              <option>PKR</option>
              <option>USD</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Warn at (%)" htmlFor="warn_pct">
            <Input id="warn_pct" name="warn_pct" type="number" min="1" max="100" step="1" required defaultValue={b?.warn_pct ?? 80} className="tabular" />
          </Field>
          <Field label="Stop at (%)" htmlFor="stop_pct">
            <Input id="stop_pct" name="stop_pct" type="number" min="1" max="200" step="1" required defaultValue={b?.stop_pct ?? 100} className="tabular" />
          </Field>
        </div>
        <label className="flex items-center gap-3 text-body">
          <input type="checkbox" name="is_active" defaultChecked={b?.is_active ?? true} className="size-4 accent-[var(--brand-600)]" />
          Active
        </label>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>Save</Button>
        </div>
      </form>
    </SidePanel>
  );
}

/* ---------- Pricing and budgets tab ---------- */

function PricingTab({ plans, rates, budgets, changes, today }: { plans: PlanRow[]; rates: RateRow[]; budgets: BudgetRow[]; changes: ChangeRow[]; today: string }) {
  const [planPanel, setPlanPanel] = React.useState<PlanRow | "new" | null>(null);
  const [ratePanel, setRatePanel] = React.useState<{ rate: RateRow; mode: "edit" | "new-version" } | null>(null);
  const [budgetPanel, setBudgetPanel] = React.useState<BudgetRow | "new" | null>(null);
  const [showAllVersions, setShowAllVersions] = React.useState(false);

  const current = currentRates(rates, today);
  const visibleRates = showAllVersions ? rates : rates.filter((r) => current.get(`${r.provider}|${r.item}|${r.country}`)?.id === r.id || r.effective_from > today);
  const versionCount = (r: RateRow) => rates.filter((x) => x.provider === r.provider && x.item === r.item && x.country === r.country).length;

  const planCols: Column<PlanRow>[] = [
    { key: "name", header: "Name", cell: (p) => <span className="font-medium">{p.plan_name}</span>, value: (p) => p.plan_name },
    { key: "provider", header: "Provider", cell: (p) => providerLabel(p.provider), value: (p) => providerLabel(p.provider) },
    { key: "kind", header: "Type", cell: (p) => (p.kind === "plan" ? "Usage plan" : "Service charge"), value: (p) => p.kind },
    { key: "price", header: "Monthly price", numeric: true, cell: (p) => (p.monthly_price === null ? <StatusChip tone="warning">Not set</StatusChip> : formatMoney(Number(p.monthly_price), p.currency)), value: (p) => p.monthly_price },
    { key: "cap", header: "Cap", numeric: true, cell: (p) => (p.usage_cap === null ? "No cap" : `${formatNumber(Number(p.usage_cap))} ${p.usage_unit ?? ""}`), value: (p) => p.usage_cap },
    {
      key: "renewal",
      header: "Next renewal",
      cell: (p) => {
        if (!p.next_renewal_date) return <span className="text-fg-muted">Not set</span>;
        const days = Math.round((new Date(p.next_renewal_date).getTime() - new Date(today).getTime()) / 86_400_000);
        return days >= 0 && days <= 7 ? <StatusChip tone="warning">{formatPkDate(p.next_renewal_date)}, in {days} days</StatusChip> : formatPkDate(p.next_renewal_date);
      },
      value: (p) => p.next_renewal_date,
    },
    { key: "status", header: "Status", cell: (p) => (p.is_active ? <StatusChip tone="success">Active</StatusChip> : <StatusChip tone="neutral">Inactive</StatusChip>), value: (p) => (p.is_active ? 1 : 0) },
    { key: "edit", header: "", cell: (p) => <Button variant="ghost" size="icon" aria-label={`Edit ${p.plan_name}`} onClick={(e) => { e.stopPropagation(); setPlanPanel(p); }}><Pencil /></Button> },
  ];

  const rateCols: Column<RateRow>[] = [
    {
      key: "label",
      header: "Item",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.label}</span>
          <span className="text-helper text-fg-muted">{providerLabel(r.provider)}{r.country !== "*" ? ` · ${r.country}` : ""}</span>
        </span>
      ),
      value: (r) => r.label,
    },
    { key: "rate", header: "Price", numeric: true, cell: (r) => (r.rate === null ? <StatusChip tone="warning">Not set</StatusChip> : `${formatMoney(Number(r.rate), r.currency)} / ${r.unit}`), value: (r) => r.rate },
    { key: "free", header: "Free allowance", numeric: true, cell: (r) => (r.free_allowance === null ? "None" : `${formatNumber(Number(r.free_allowance))} per ${r.allowance_period ?? "period"}`), value: (r) => r.free_allowance },
    {
      key: "from",
      header: "Effective from",
      cell: (r) => (
        <span className="flex items-center gap-2">
          {formatPkDate(r.effective_from)}
          {r.effective_from > today ? <StatusChip tone="info">Upcoming</StatusChip> : current.get(`${r.provider}|${r.item}|${r.country}`)?.id === r.id ? null : <StatusChip tone="neutral">Past</StatusChip>}
        </span>
      ),
      value: (r) => r.effective_from,
    },
    { key: "versions", header: "Versions", numeric: true, cell: (r) => versionCount(r), value: (r) => versionCount(r) },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <span className="flex justify-end gap-1">
          <Button variant="secondary" size="sm" onClick={() => setRatePanel({ rate: r, mode: "new-version" })}>
            <CalendarClock /> New price
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Correct ${r.label}`} onClick={() => setRatePanel({ rate: r, mode: "edit" })}>
            <Pencil />
          </Button>
        </span>
      ),
    },
  ];

  const budgetCols: Column<BudgetRow>[] = [
    { key: "name", header: "Name", cell: (b) => <span className="font-medium">{b.name}</span>, value: (b) => b.name },
    {
      key: "scope",
      header: "Applies to",
      cell: (b) => [providerLabel(b.provider), b.product ? b.product[0].toUpperCase() + b.product.slice(1) : "All products", b.channel ? (b.channel === "whatsapp" ? "WhatsApp" : "Email") : "All channels"].join(" · "),
    },
    { key: "month", header: "Month", cell: (b) => (b.month ? formatPkDate(b.month).replace(/^\d+ /, "") : "Every month"), value: (b) => b.month },
    { key: "amount", header: "Amount", numeric: true, cell: (b) => formatMoney(Number(b.amount), b.currency), value: (b) => Number(b.amount) },
    { key: "limits", header: "Warn / stop", numeric: true, cell: (b) => `${Number(b.warn_pct)}% / ${Number(b.stop_pct)}%` },
    { key: "status", header: "Status", cell: (b) => (b.is_active ? <StatusChip tone="success">Active</StatusChip> : <StatusChip tone="neutral">Inactive</StatusChip>) },
    { key: "edit", header: "", cell: (b) => <Button variant="ghost" size="icon" aria-label={`Edit ${b.name}`} onClick={() => setBudgetPanel(b)}><Pencil /></Button> },
  ];

  const changeCols: Column<ChangeRow>[] = [
    { key: "when", header: "When (PKT)", cell: (c) => <span className="tabular whitespace-nowrap">{formatPkDateTime(c.changed_at)}</span>, value: (c) => c.changed_at },
    { key: "who", header: "Who", cell: (c) => c.changed_by_email ?? "System setup", value: (c) => c.changed_by_email ?? "System setup" },
    {
      key: "what",
      header: "What",
      cell: (c) => {
        const name = String((c.new_values ?? c.old_values)?.plan_name ?? (c.new_values ?? c.old_values)?.label ?? (c.new_values ?? c.old_values)?.name ?? "");
        return `${TABLE_LABELS[c.table_name] ?? c.table_name} ${c.action === "insert" ? "added" : c.action === "update" ? "changed" : "removed"}: ${name}`;
      },
      value: (c) => c.table_name,
    },
    {
      key: "diff",
      header: "Change",
      cell: (c) =>
        c.action === "update" ? (
          <span className="text-helper">
            {changedFields(c.old_values, c.new_values)
              .map((d) => `${d.field}: ${d.from ?? "empty"} → ${d.to ?? "empty"}`)
              .join(" · ") || "No visible change"}
          </span>
        ) : (
          <span className="text-helper text-fg-muted">{c.action === "insert" ? "New record" : "Removed"}</span>
        ),
      value: (c) => JSON.stringify(changedFields(c.old_values, c.new_values)),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-section font-semibold">Plans and service charges</h2>
            <p className="text-helper text-fg-muted">Monthly fees and usage caps. Renewals within seven days are highlighted.</p>
          </div>
          <Button variant="primary" onClick={() => setPlanPanel("new")}>
            <Plus /> Add plan
          </Button>
        </div>
        <DataTable rows={plans} columns={planCols} rowKey={(p) => p.id} onRowClick={setPlanPanel} exportName="prospector-plans" onExport={(n) => void logCostExport("cost_plans", n)} empty={<EmptyState icon={Receipt} message="No plans yet." />} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-section font-semibold">Prices</h2>
            <p className="text-helper text-fg-muted">Per-unit prices. A new price starts on its date; older reports keep the old price. Prices marked Not set block spend.</p>
          </div>
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" checked={showAllVersions} onChange={(e) => setShowAllVersions(e.target.checked)} className="size-4 accent-[var(--brand-600)]" />
            Show past prices
          </label>
        </div>
        <DataTable rows={visibleRates} columns={rateCols} rowKey={(r) => r.id} initialPageSize={25} exportName="prospector-prices" onExport={(n) => void logCostExport("cost_rates", n)} empty={<EmptyState icon={Wallet} message="No prices yet." />} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-section font-semibold">Budgets</h2>
            <p className="text-helper text-fg-muted">Per month, product and channel, with a warning and an automatic stop percentage.</p>
          </div>
          <Button variant="secondary" onClick={() => setBudgetPanel("new")}>
            <Plus /> Add budget
          </Button>
        </div>
        <DataTable rows={budgets} columns={budgetCols} rowKey={(b) => b.id} onRowClick={setBudgetPanel} exportName="prospector-budgets" onExport={(n) => void logCostExport("budgets", n)} empty={<EmptyState icon={Wallet} message="No budgets yet. Without a Google budget, searches will be blocked in step 2." action={<Button variant="primary" onClick={() => setBudgetPanel("new")}><Plus /> Add budget</Button>} />} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-section font-semibold">Change history</h2>
          <p className="text-helper text-fg-muted">Every change to plans, prices and budgets, with who made it. Entries cannot be edited.</p>
        </div>
        <DataTable rows={changes} columns={changeCols} rowKey={(c) => String(c.id)} exportName="prospector-cost-history" onExport={(n) => void logCostExport("cost_change_log", n)} empty={<EmptyState icon={History} message="No changes yet." />} />
      </section>

      {planPanel ? <PlanPanel plan={planPanel} onClose={() => setPlanPanel(null)} /> : null}
      {ratePanel ? <RatePanel rate={ratePanel.rate} mode={ratePanel.mode} today={today} onClose={() => setRatePanel(null)} /> : null}
      {budgetPanel ? <BudgetPanel budget={budgetPanel} onClose={() => setBudgetPanel(null)} /> : null}
    </div>
  );
}

export function CostsScreen({
  today,
  month,
  plans,
  rates,
  budgets,
  changes,
  usagePkr,
  spendByProduct,
}: {
  today: string;
  month: string;
  plans: PlanRow[];
  rates: RateRow[];
  budgets: BudgetRow[];
  changes: ChangeRow[];
  usagePkr: number;
  spendByProduct: Record<string, number>;
}) {
  const [currencyView, setCurrencyView] = React.useState<Currency>("PKR");
  const fx = currentRates(rates, today).get("fx|usd_to_pkr|*")?.rate ?? null;
  const later = [
    { v: "email", label: "Email (Resend)", msg: "Emails sent, remaining cap and projected month-end usage appear here once email sending is built in step 5. The Resend plan and cap are already editable under Pricing and budgets." },
    { v: "whatsapp", label: "WhatsApp (Meta)", msg: "Message counts and cost by category appear here once WhatsApp sending is built in step 6. Per-category rates are already editable under Pricing and budgets." },
    { v: "platform", label: "Platform service charges", msg: "The renewal calendar and alerts arrive in step 9. Fixed fees are already editable under Pricing and budgets." },
    { v: "google", label: "Google APIs", msg: "Daily and monthly calls and spend against the free allowance appear here once the Places worker runs in step 2." },
    { v: "social", label: "Social APIs", msg: "Social API usage is a later phase (SRS 9.3). Its plan and price are already editable under Pricing and budgets." },
  ];
  return (
    <>
      <PageHeader title="Costs" description="Every price, cap and budget is editable here. Nothing is fixed in code." />
      <SummaryHeader plans={plans} budgets={budgets} usdToPkr={fx === null ? null : Number(fx)} usagePkr={usagePkr} spendByProduct={spendByProduct} month={month} currency={currencyView} onCurrency={setCurrencyView} />
      <Tabs defaultValue="pricing">
        <TabsList tabs={[...later.map((l) => ({ value: l.v, label: l.label })), { value: "pricing", label: "Pricing and budgets" }]} />
        {later.map((l) => (
          <TabsContent key={l.v} value={l.v}>
            <Card>
              <CardHeader title={l.label} />
              <EmptyState icon={Receipt} message={l.msg} />
            </Card>
          </TabsContent>
        ))}
        <TabsContent value="pricing">
          <PricingTab plans={plans} rates={rates} budgets={budgets} changes={changes} today={today} />
        </TabsContent>
      </Tabs>
    </>
  );
}
