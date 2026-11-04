"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShellUser } from "./app-shell";

const PRODUCTS = [
  { value: "", label: "All" },
  { value: "classwell", label: "Classwell" },
  { value: "vetlin", label: "Vetlin" },
  { value: "postwala", label: "Postwala" },
];

/** 56 px top bar: product switcher and global search (Ctrl K). */
export function Topbar({
  onOpenDrawer,
  onOpenPalette,
}: {
  user: ShellUser;
  onOpenDrawer: () => void;
  onOpenPalette: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const product = params.get("product") ?? "";

  function setProduct(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("product", value);
    else next.delete("product");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:px-6">
      <button type="button" className="grid size-9 place-items-center rounded-control hover:bg-neutral-soft md:hidden" onClick={onOpenDrawer} aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div role="radiogroup" aria-label="Product" className="hidden items-center rounded-control border border-border p-1 sm:flex">
        {PRODUCTS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={product === p.value}
            onClick={() => setProduct(p.value)}
            className={cn(
              "h-7 rounded-[6px] px-3 text-helper font-medium text-fg-muted hover:text-fg",
              product === p.value && "bg-brand-600 text-white hover:text-white",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpenPalette}
        className="ml-auto flex h-9 w-full max-w-sm items-center gap-2 rounded-control border border-border bg-page px-3 text-body text-fg-muted hover:border-brand-600"
        aria-label="Search and jump to a screen"
      >
        <Search className="size-4" aria-hidden />
        <span className="truncate">Search businesses, emails, phones…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-surface px-1 text-helper sm:inline">Ctrl K</kbd>
      </button>
    </header>
  );
}
