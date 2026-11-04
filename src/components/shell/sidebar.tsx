"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, LogOut, X } from "lucide-react";
import { NAV, type NavItem } from "@/lib/nav";
import { canAccess, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/logo";
import { signOut } from "@/app/(auth)/login/actions";
import type { ShellUser } from "./app-shell";

export const CURRENT_STEP = 5;

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/searches") return pathname === "/searches" || (pathname.startsWith("/searches/") && !pathname.startsWith("/searches/new"));
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initials(name: string, email: string) {
  const src = name.trim() || email;
  return src
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function NavContent({ role, user, rail, onNavigate }: { role: Role; user: ShellUser; rail: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(role, i.screen)) })).filter((g) => g.items.length);
  return (
    <>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            {rail ? (
              <div className="mx-auto mb-2 h-px w-6 bg-brand-700" aria-hidden />
            ) : (
              <p className="mb-1 px-3 text-helper font-medium uppercase tracking-wide text-[#7f9c99]">{g.label}</p>
            )}
            <ul className="flex flex-col gap-1">
              {g.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={rail ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-3 rounded-control px-3 text-body text-[#c9d6d4] hover:bg-brand-700 hover:text-white",
                        active && "bg-brand-700 font-medium text-white",
                        rail && "justify-center px-0",
                      )}
                    >
                      {active ? <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-whatsapp" aria-hidden /> : null}
                      <Icon className="size-5 shrink-0" strokeWidth={1.5} aria-hidden />
                      {rail ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                      {!rail && item.step > CURRENT_STEP ? (
                        <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-[#1b3133] px-2 text-[11px] leading-5 text-[#7f9c99]">Step {item.step}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cn("flex items-center gap-3 border-t border-brand-700 p-3", rail && "flex-col")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 text-helper font-semibold text-white" aria-hidden>
          {initials(user.fullName, user.email)}
        </span>
        {!rail ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-white">{user.fullName || user.email}</p>
            <p className="truncate text-helper text-[#7f9c99]">{ROLE_LABELS[user.role]}</p>
          </div>
        ) : null}
        <form action={signOut}>
          <button type="submit" className="grid size-8 place-items-center rounded-control text-[#c9d6d4] hover:bg-brand-700 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </>
  );
}

export function Sidebar({
  role,
  user,
  collapsed,
  onToggleCollapsed,
  drawerOpen,
  onCloseDrawer,
}: {
  role: Role;
  user: ShellUser;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  return (
    <>
      {/* Tablet and desktop: rail between 768 and 1279 px, full or collapsed from 1280 px. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-brand-900 md:flex",
          "w-[var(--sidebar-rail)]",
          !collapsed && "xl:w-[var(--sidebar-width)]",
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <LogoMark />
          <span className={cn("hidden text-section font-semibold text-white", !collapsed && "xl:inline")}>Prospector</span>
        </div>
        <div className={cn("hidden min-h-0 flex-1 flex-col", !collapsed && "xl:flex")}>
          <NavContent role={role} user={user} rail={false} />
        </div>
        <div className={cn("flex min-h-0 flex-1 flex-col", !collapsed && "xl:hidden")}>
          <NavContent role={role} user={user} rail />
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="hidden h-10 items-center justify-center gap-2 border-t border-brand-700 text-helper text-[#c9d6d4] hover:bg-brand-700 hover:text-white xl:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </aside>

      {/* Phone: slide-in drawer. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-fg/40" onClick={onCloseDrawer} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[var(--sidebar-width)] max-w-[85vw] flex-col bg-brand-900 shadow-float">
            <div className="flex h-14 items-center justify-between px-4">
              <span className="flex items-center gap-2">
                <LogoMark />
                <span className="text-section font-semibold text-white">Prospector</span>
              </span>
              <button type="button" onClick={onCloseDrawer} className="grid size-9 place-items-center rounded-control text-white hover:bg-brand-700" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            <NavContent role={role} user={user} rail={false} onNavigate={onCloseDrawer} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
