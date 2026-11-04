"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { toast } from "@/components/ui/toaster";
import { LEAD_STATUS } from "@/lib/engine/labels";
import { formatPkDate } from "@/lib/utils";
import { mergeLeads } from "../actions";

type DupLead = { id: string; name: string; product: Product; city: string | null; area: string | null; phone: string | null; website: string | null; email: string | null; whatsapp: string | null; status: keyof typeof LEAD_STATUS; score: number; created_at: string };
export type DupGroup = { key: string; city: string | null; leads: DupLead[] };

export function DuplicatesScreen({ groups }: { groups: DupGroup[] }) {
  const router = useRouter();
  const [keep, setKeep] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<DupGroup | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (groups.length === 0) {
    return <Card><EmptyState icon={CheckCircle2} message="No likely duplicates found." /></Card>;
  }

  const keepOf = (g: DupGroup) => keep[g.key] ?? g.leads[0].id;

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <Card key={g.key}>
          <CardHeader
            title={`${g.leads[0].name}${g.city ? `, ${g.city}` : ""}`}
            description={`${g.leads.length} records`}
            action={<Button variant="primary" size="sm" onClick={() => setConfirm(g)}><GitMerge /> Merge</Button>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="bg-neutral-soft text-left text-helper text-fg-muted">
                <tr>
                  <th className="h-10 w-20 px-3 font-semibold">Keep</th>
                  <th className="px-3 font-semibold">Name</th>
                  <th className="px-3 font-semibold">Product</th>
                  <th className="px-3 font-semibold">Phone</th>
                  <th className="px-3 font-semibold">Website</th>
                  <th className="px-3 font-semibold">Email</th>
                  <th className="px-3 font-semibold">Status</th>
                  <th className="px-3 font-semibold">Added</th>
                </tr>
              </thead>
              <tbody>
                {g.leads.map((l) => (
                  <tr key={l.id} className="h-11 border-t border-border">
                    <td className="px-3">
                      <input type="radio" name={`keep-${g.key}`} aria-label={`Keep ${l.name} added ${formatPkDate(l.created_at)}`} checked={keepOf(g) === l.id} onChange={() => setKeep({ ...keep, [g.key]: l.id })} className="size-4 accent-[var(--brand-600)]" />
                    </td>
                    <td className="px-3"><Link href={`/leads/${l.id}`} className="hover:underline">{l.name}</Link>{l.area ? <span className="text-fg-muted">, {l.area}</span> : null}</td>
                    <td className="px-3"><ProductChip product={l.product} /></td>
                    <td className="tabular px-3">{l.phone ?? "—"}</td>
                    <td className="max-w-44 truncate px-3">{l.website ?? "—"}</td>
                    <td className="max-w-44 truncate px-3">{l.email ?? "—"}</td>
                    <td className="px-3"><StatusChip tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</StatusChip></td>
                    <td className="px-3">{formatPkDate(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Merge these leads?"
        description={confirm ? `${confirm.leads.length - 1} record${confirm.leads.length > 2 ? "s" : ""} will be merged into the one you chose and then removed. Contacts, notes, history and tags move across. This cannot be undone.` : ""}
        confirmLabel="Merge leads"
        loading={busy}
        onConfirm={async () => {
          if (!confirm) return;
          setBusy(true);
          const k = keepOf(confirm);
          const r = await mergeLeads(k, confirm.leads.map((l) => l.id).filter((id) => id !== k));
          setBusy(false);
          setConfirm(null);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
          router.refresh();
        }}
      />
    </div>
  );
}
