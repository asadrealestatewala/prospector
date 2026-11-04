import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** SRS 4A buttons: 36 px high, 8 px radius. One primary per screen area. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-medium transition-colors disabled:pointer-events-none disabled:text-fg-disabled disabled:opacity-70 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-neutral-soft",
        secondary: "border border-border bg-surface text-fg hover:bg-brand-50",
        whatsapp: "bg-whatsapp text-[#08361b] hover:brightness-95 disabled:bg-neutral-soft",
        destructive: "border border-border bg-surface text-error hover:bg-error-soft",
        "destructive-solid": "bg-error text-white hover:brightness-110",
        ghost: "text-fg hover:bg-neutral-soft",
        link: "h-auto px-0 text-brand-600 underline-offset-4 hover:underline",
      },
      size: {
        md: "h-9 px-4",
        sm: "h-8 px-3 text-helper",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
