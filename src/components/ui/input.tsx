import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-control border border-border bg-surface px-3 text-body text-fg placeholder:text-fg-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:border-brand-600 disabled:bg-neutral-soft disabled:text-fg-disabled aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldBase, "h-9", className)} {...props} />,
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(fieldBase, "h-9 pr-8", className)} {...props} />,
);
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />,
);
Textarea.displayName = "Textarea";

/** Visible label, optional hint, and an error message below in red (SRS 4A inputs). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-helper font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-helper text-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-helper text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
