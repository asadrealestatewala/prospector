import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** KPI card: label, large number, change versus previous period, and a link to the filtered report. */
export function KpiCard({
  label,
  value,
  change,
  href,
  className,
}: {
  label: string;
  value: string;
  change?: { value: string; direction: "up" | "down"; good: boolean } | null;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-1 rounded-card border border-border bg-surface p-4 transition-colors hover:border-brand-600 hover:bg-brand-50",
        className,
      )}
    >
      <span className="text-helper text-fg-muted">{label}</span>
      <span className="tabular text-kpi font-semibold text-fg">{value}</span>
      {change ? (
        <span className={cn("inline-flex items-center gap-1 text-helper", change.good ? "text-success" : "text-error")}>
          {change.direction === "up" ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowDownRight className="size-4" aria-hidden />}
          {change.value} vs previous period
        </span>
      ) : (
        <span className="text-helper text-fg-muted">No previous period yet</span>
      )}
    </Link>
  );
}
