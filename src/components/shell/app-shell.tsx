"use client";
import * as React from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import type { Role } from "@/lib/auth/roles";

export type ShellUser = { fullName: string; email: string; role: Role };

export const SIDEBAR_COOKIE = "prospector_sidebar";

/**
 * Sidebar 256 px, collapsing to a 64 px icon rail; rail between 768 and 1279 px;
 * slide-in drawer below 768 px. Top bar 56 px. Content padding 24 px, max width 1440 px.
 */
export function AppShell({ user, initialCollapsed, children }: { user: ShellUser; initialCollapsed: boolean; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        role={user.role}
        user={user}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <React.Suspense fallback={<div className="h-14 border-b border-border bg-surface" />}>
          <Topbar user={user} onOpenDrawer={() => setDrawerOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        </React.Suspense>
        <main id="main" className="mx-auto w-full max-w-[var(--content-max)] flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={user.role} />
    </div>
  );
}
