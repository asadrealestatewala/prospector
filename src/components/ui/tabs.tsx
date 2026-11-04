"use client";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

/** Underlined tabs, brand-600 on the active tab. Scrolls sideways on small screens. */
export function TabsList({ tabs, className }: { tabs: { value: string; label: string }[]; className?: string }) {
  return (
    <T.List className={cn("mb-6 flex gap-4 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t) => (
        <T.Trigger
          key={t.value}
          value={t.value}
          className="-mb-px whitespace-nowrap border-b-2 border-transparent px-1 pb-3 pt-1 text-body font-medium text-fg-muted hover:text-fg data-[state=active]:border-brand-600 data-[state=active]:text-brand-600"
        >
          {t.label}
        </T.Trigger>
      ))}
    </T.List>
  );
}
