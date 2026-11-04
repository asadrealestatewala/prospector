"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Modal for confirmations and short forms: 12 px radius, shadow only on floating layers. */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-fg/40" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface shadow-float",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <D.Title className="text-section font-semibold text-fg">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-body text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </D.Close>
        </div>
        {children ? <div className="overflow-y-auto px-6 py-4">{children}</div> : null}
        {footer ? <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div> : null}
      </D.Content>
    </D.Portal>
  );
}

/**
 * Confirmation for deletes, bulk sends and stop-all actions. Names what will happen and how many records.
 * Solid red only appears inside this dialog.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </DialogClose>
            <Button variant={destructive ? "destructive-solid" : "primary"} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

/** Right-hand side panel for quick previews and edits. */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-fg/30" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface shadow-float">
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              <D.Title className="text-section font-semibold text-fg">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-body text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close panel">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
