import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Simple icon, one sentence, one primary action. */
export function EmptyState({
  icon: Icon,
  message,
  action,
  className,
}: {
  icon: LucideIcon;
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-12 text-center", className)}>
      <span className="grid size-12 place-items-center rounded-full bg-neutral-soft text-fg-muted">
        <Icon className="size-5" strokeWidth={1.5} aria-hidden />
      </span>
      <p className="max-w-md text-body text-fg-muted">{message}</p>
      {action}
    </div>
  );
}
