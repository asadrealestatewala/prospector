"use client";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import { KeyRound, ShieldCheck } from "lucide-react";
import { NAV } from "@/lib/nav";
import { canAccess, type Role } from "@/lib/auth/roles";

/** Ctrl K: jump between screens. Lead, email and phone search joins in build step 2. */
export function CommandPalette({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: Role }) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-fg/40" />
        <D.Content className="fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card bg-surface shadow-float">
          <D.Title className="sr-only">Search and jump</D.Title>
          <D.Description className="sr-only">Type a screen name and press Enter.</D.Description>
          <Command label="Command palette" className="flex flex-col">
            <Command.Input placeholder="Type a screen or action…" className="h-12 border-b border-border px-4 text-body outline-none" />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-body text-fg-muted">Nothing matches that yet.</Command.Empty>
              {NAV.map((g) => {
                const items = g.items.filter((i) => canAccess(role, i.screen));
                if (!items.length) return null;
                return (
                  <Command.Group key={g.label} heading={g.label} className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-helper [&_[cmdk-group-heading]]:text-fg-muted">
                    {items.map((i) => {
                      const Icon = i.icon;
                      return (
                        <Command.Item key={i.href} value={`${g.label} ${i.label}`} onSelect={() => go(i.href)} className="flex h-9 cursor-pointer items-center gap-3 rounded-control px-3 text-body data-[selected=true]:bg-brand-50">
                          <Icon className="size-4 text-fg-muted" strokeWidth={1.5} />
                          {i.label}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                );
              })}
              <Command.Group heading="Account" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-helper [&_[cmdk-group-heading]]:text-fg-muted">
                <Command.Item value="Change password" onSelect={() => go("/account/password")} className="flex h-9 cursor-pointer items-center gap-3 rounded-control px-3 text-body data-[selected=true]:bg-brand-50">
                  <KeyRound className="size-4 text-fg-muted" strokeWidth={1.5} /> Change password
                </Command.Item>
                {role === "admin" || role === "manager" ? (
                  <Command.Item value="Two-step verification" onSelect={() => go("/account/security")} className="flex h-9 cursor-pointer items-center gap-3 rounded-control px-3 text-body data-[selected=true]:bg-brand-50">
                    <ShieldCheck className="size-4 text-fg-muted" strokeWidth={1.5} /> Two-step verification
                  </Command.Item>
                ) : null}
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
