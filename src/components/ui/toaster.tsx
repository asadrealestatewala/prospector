"use client";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";

/** Bottom right, auto-dismiss after five seconds; errors stay until closed. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      duration={5000}
      closeButton
      toastOptions={{ classNames: { toast: "rounded-card border border-border text-body", error: "text-error" } }}
    />
  );
}

export const toast = {
  success: (message: string, opts?: { undo?: () => void }) =>
    sonnerToast.success(message, opts?.undo ? { duration: 10_000, action: { label: "Undo", onClick: opts.undo } } : undefined),
  info: (message: string) => sonnerToast(message),
  error: (message: string) => sonnerToast.error(message, { duration: Infinity }),
};
