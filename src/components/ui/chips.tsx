import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "error" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  error: "bg-error-soft text-error",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-neutral",
};

/** Soft background, matching text and a dot, 24 px high. Always carries a word, never colour alone. */
export function StatusChip({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-helper font-medium", TONE[tone], className)}>
      <span className="size-2 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export type Product = "classwell" | "vetlin" | "postwala";

export const PRODUCT_LABELS: Record<Product, string> = {
  classwell: "Classwell",
  vetlin: "Vetlin",
  postwala: "Postwala",
};

const PRODUCT_STYLE: Record<Product, string> = {
  classwell: "bg-classwell-soft text-classwell",
  vetlin: "bg-vetlin-soft text-vetlin",
  postwala: "bg-postwala-soft text-postwala",
};

export function ProductChip({ product, className }: { product: Product; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-3 text-helper font-medium", PRODUCT_STYLE[product], className)}>
      {PRODUCT_LABELS[product]}
    </span>
  );
}

export function WhatsAppChip({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full bg-[#dcf8e7] px-3 text-helper font-medium text-[#0b5c2e]", className)}>
      <span className="size-2 rounded-full bg-whatsapp" aria-hidden />
      WhatsApp
    </span>
  );
}
