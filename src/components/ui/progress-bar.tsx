import { cn } from "@/lib/utils";

/** brand-600 on a neutral track; amber near the limit, red at the limit. */
export function ProgressBar({
  value,
  max,
  warnAt = 80,
  label,
  className,
  isLimit = true,
}: {
  value: number;
  max: number | null;
  warnAt?: number;
  label: string;
  className?: string;
  /** False for plain progress (cities done), where reaching 100% is good, not a warning. */
  isLimit?: boolean;
}) {
  const pct = max && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = !isLimit ? "bg-brand-600" : pct >= 100 ? "bg-error" : pct >= warnAt ? "bg-warning" : "bg-brand-600";
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-neutral-soft", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className={cn("h-full rounded-full transition-[width]", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
