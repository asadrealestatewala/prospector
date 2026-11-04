import { cn } from "@/lib/utils";

/** Prospector mark: a target ring on brand teal. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brand-600)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="3" fill="var(--whatsapp-500)" />
    </svg>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cn("text-section font-semibold", light ? "text-white" : "text-fg")}>Prospector</span>
    </span>
  );
}
