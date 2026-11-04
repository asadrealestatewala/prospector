"use client";
import { X } from "lucide-react";

/** Active filters as removable chips above a table. Save view arrives with the Leads screen. */
export function FilterBar({
  children,
  active,
  onRemove,
}: {
  children?: React.ReactNode;
  active: { key: string; label: string }[];
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {active.map((f) => (
        <span key={f.key} className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-100 pl-3 pr-1 text-helper text-brand-700">
          {f.label}
          <button type="button" aria-label={`Remove filter ${f.label}`} className="grid size-4 place-items-center rounded-full hover:bg-brand-50" onClick={() => onRemove(f.key)}>
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
