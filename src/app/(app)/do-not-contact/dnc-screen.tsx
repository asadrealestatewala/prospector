"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Ban, Download, Plus, Search, Upload, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chips";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { dncRowsFromCsv } from "@/lib/csv";
import {
  CHANNEL_LABEL, CHANNELS, CONSENT_SOURCE_LABEL, DNC_REASON_LABEL, DNC_REASONS,
  type DncFilters,
} from "@/lib/compliance/filters";
import { formatPkDateTime } from "@/lib/utils";
import { addDoNotContact, removeDoNotContact } from "./actions";

export type DncRow = {
  id: string;
  channel: (typeof CHANNELS)[number];
  value: string;
  reason: (typeof DNC_REASONS)[number];
  note: string | null;
  source: keyof typeof CONSENT_SOURCE_LABEL;
  added_by_system: string | null;
  created_at: string;
  removed_at: string | null;
  removal_reason: string | null;
  lead_id: string | null;
  leadName: string | null;
  addedBy: string | null;
  removedBy: string | null;
};

type Run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => Promise<boolean>;

/** SRS screen 14: everyone who must never be messaged. Admin only. */
export function DncScreen({ rows, total, filters, page, size, loadError }: { rows: DncRow[]; total: number; filters: DncFilters; page: number; size: number; loadError: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState(filters.q ?? "");
  const [dialog, setDialog] = React.useState<null | "add" | "import" | { remove: DncRow }>(null);
  const [busy, setBusy] = React.useState(false);

  function navigate(next: Partial<DncFilters>, resetPage = true) {
    const merged: Record<string, unknown> = { ...filters, ...next };
    if (resetPage) delete merged.page;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }
  React.useEffect(() => {
    if ((filters.q ?? "") === q) return;
    const t = setTimeout(() => navigate({ q: q.trim() || undefined }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const run: Run = async (fn) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      toast.success(r.message ?? "Done.");
      setDialog(null);
      router.refresh();
      return true;
    }
    toast.error(r.error ?? "Something went wrong.");
    return false;
  };

  const active = [
    filters.channel ? { key: "channel", label: CHANNEL_LABEL[filters.channel] } : null,
    filters.reason ? { key: "reason", label: DNC_REASON_LABEL[filters.reason] } : null,
    filters.removed ? { key: "removed", label: "Removed entries" } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const exportParams = new URLSearchParams();
  for (const k of ["q", "channel", "reason", "removed"] as const) if (filters[k]) exportParams.set(k, String(filters[k]));

  const columns: Column<DncRow>[] = [
    { key: "value", header: "Email or phone", sortable: false, cell: (r) => <span className="tabular break-all font-medium">{r.value}</span> },
    { key: "channel", header: "Channel", sortable: false, cell: (r) => CHANNEL_LABEL[r.channel] },
    { key: "reason", header: "Reason", sortable: false, cell: (r) => <StatusChip tone={r.reason === "manual" ? "neutral" : "error"}>{DNC_REASON_LABEL[r.reason]}</StatusChip> },
    {
      key: "lead",
      header: "Lead",
      sortable: false,
      cell: (r) => (r.lead_id && r.leadName ? <Link href={`/leads/${r.lead_id}`} className="text-brand-600 hover:underline">{r.leadName}</Link> : <span className="text-fg-muted">Not linked</span>),
    },
    {
      key: "added",
      header: "Added",
      sortable: false,
      cell: (r) => (
        <div className="text-helper">
          <p>{formatPkDateTime(r.created_at)}</p>
          <p className="text-fg-muted">
            {r.addedBy ?? r.added_by_system ?? "System"} · {CONSENT_SOURCE_LABEL[r.source] ?? r.source}
          </p>
          {r.note ? <p className="text-fg-muted">{r.note}</p> : null}
        </div>
      ),
    },
    filters.removed
      ? {
          key: "removed",
          header: "Removed",
          sortable: false,
          cell: (r) => (
            <div className="text-helper">
              <p>{r.removed_at ? formatPkDateTime(r.removed_at) : ""} by {r.removedBy ?? "an Admin"}</p>
              <p className="text-fg-muted">{r.removal_reason}</p>
            </div>
          ),
        }
      : {
          key: "actions",
          header: "",
          sortable: false,
          cell: (r) => (
            <Button size="sm" variant="ghost" onClick={() => setDialog({ remove: r })}>
              <Undo2 /> Remove
            </Button>
          ),
        },
  ];

  return (
    <>
      <PageHeader
        title="Do-Not-Contact"
        description="Contacts who must never be messaged. Every send is checked against this list at the moment of sending."
        actions={
          <>
            <Button asChild>
              <a href={`/do-not-contact/export?${exportParams.toString()}`}><Download /> Export CSV</a>
            </Button>
            <Button onClick={() => setDialog("import")}><Upload /> Import CSV</Button>
            <Button variant="primary" onClick={() => setDialog("add")}><Plus /> Add</Button>
          </>
        }
      />

      {loadError ? <p className="mb-4 text-body text-error">{loadError}</p> : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        manual={{
          total,
          page,
          pageSize: size,
          sort: null,
          onPage: (p) => navigate({ page: p }, false),
          onPageSize: (s) => navigate({ size: s }),
          onSort: () => undefined,
        }}
        toolbar={
          <FilterBar active={active} onRemove={(k) => navigate({ [k]: undefined } as Partial<DncFilters>)}>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <label htmlFor="dnc-q" className="sr-only">Search email or phone</label>
              <Input id="dnc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or phone" className="pl-9" />
            </div>
            <label htmlFor="dnc-channel" className="sr-only">Channel</label>
            <Select id="dnc-channel" className="w-auto" value={filters.channel ?? ""} onChange={(e) => navigate({ channel: (e.target.value || undefined) as DncFilters["channel"] })}>
              <option value="">All channels</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </Select>
            <label htmlFor="dnc-reason" className="sr-only">Reason</label>
            <Select id="dnc-reason" className="w-auto" value={filters.reason ?? ""} onChange={(e) => navigate({ reason: (e.target.value || undefined) as DncFilters["reason"] })}>
              <option value="">All reasons</option>
              {DNC_REASONS.map((r) => <option key={r} value={r}>{DNC_REASON_LABEL[r]}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-body" htmlFor="dnc-removed">
              <input id="dnc-removed" type="checkbox" checked={!!filters.removed} onChange={(e) => navigate({ removed: e.target.checked ? "1" : undefined })} className="size-4 accent-[var(--brand-600)]" />
              Show removed
            </label>
          </FilterBar>
        }
        empty={
          <EmptyState
            icon={Ban}
            message={active.length || filters.q ? "No entries match these filters." : "Nobody is on the do-not-contact list yet."}
            action={!active.length && !filters.q ? <Button variant="primary" onClick={() => setDialog("add")}><Plus /> Add</Button> : undefined}
          />
        }
      />

      {dialog === "add" ? <AddDialog busy={busy} run={run} onClose={() => setDialog(null)} /> : null}
      {dialog === "import" ? <ImportDialog busy={busy} run={run} onClose={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === "object" ? <RemoveDialog row={dialog.remove} busy={busy} run={run} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function AddDialog({ busy, run, onClose }: { busy: boolean; run: Run; onClose: () => void }) {
  const [text, setText] = React.useState("");
  const [channel, setChannel] = React.useState<"" | (typeof CHANNELS)[number]>("");
  const [reason, setReason] = React.useState<(typeof DNC_REASONS)[number]>("manual");
  const [note, setNote] = React.useState("");
  const values = text.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent
        title="Add to do-not-contact"
        description="One email or phone number per line. They will never be messaged on that channel."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={values.length === 0}
              onClick={() => run(() => addDoNotContact({ rows: values.map((value) => ({ value })), channel: channel || undefined, reason, note: note || undefined, source: "manual" }))}
            >
              Add {values.length > 1 ? values.length.toLocaleString("en-PK") : ""}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Emails or phone numbers" htmlFor="dnc-values" hint={values.length ? `${values.length.toLocaleString("en-PK")} to add` : "For example info@school.pk or 0300 1234567"}>
            <Textarea id="dnc-values" value={text} onChange={(e) => setText(e.target.value)} rows={6} className="tabular" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel" htmlFor="dnc-ch" hint="Left empty: emails are email, numbers are phone. A phone entry also blocks WhatsApp to that number.">
              <Select id="dnc-ch" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
                <option value="">Detect from the value</option>
                {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="dnc-rs">
              <Select id="dnc-rs" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {DNC_REASONS.map((r) => <option key={r} value={r}>{DNC_REASON_LABEL[r]}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Note (optional)" htmlFor="dnc-note">
            <Input id="dnc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ busy, run, onClose }: { busy: boolean; run: Run; onClose: () => void }) {
  const [rows, setRows] = React.useState<ReturnType<typeof dncRowsFromCsv> | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [reason, setReason] = React.useState<(typeof DNC_REASONS)[number]>("manual");
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent
        title="Import do-not-contact list"
        description="A CSV file with a column named email, phone or value. Optional columns: channel, reason and note."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!rows?.length}
              onClick={() => run(() => addDoNotContact({ rows: rows ?? [], reason, source: "import", note: fileName ? `Imported from ${fileName}` : undefined }))}
            >
              Import {rows?.length ? rows.length.toLocaleString("en-PK") : ""}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="CSV file" htmlFor="dnc-file" error={error} hint={rows ? `${rows.length.toLocaleString("en-PK")} rows read from ${fileName}` : "Up to 10,000 rows"}>
            <Input
              id="dnc-file"
              type="file"
              accept=".csv,text/csv"
              className="h-auto py-1.5"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setError(null);
                setRows(null);
                if (!f) return;
                if (f.size > 5_000_000) return setError("The file is larger than 5 MB. Split it into smaller files.");
                const parsed = dncRowsFromCsv(await f.text());
                if (parsed.length === 0) return setError("No emails or phone numbers were found in this file.");
                if (parsed.length > 10000) return setError(`The file has ${parsed.length.toLocaleString("en-PK")} rows. Import at most 10,000 at a time.`);
                setFileName(f.name);
                setRows(parsed);
              }}
            />
          </Field>
          {rows?.length ? (
            <div className="rounded-control border border-border bg-page px-3 py-2 text-helper">
              <p className="mb-1 font-semibold text-fg-muted">First rows</p>
              <ul className="tabular">{rows.slice(0, 5).map((r, i) => <li key={i} className="truncate">{r.value}{r.channel ? ` · ${r.channel}` : ""}{r.reason ? ` · ${r.reason}` : ""}</li>)}</ul>
            </div>
          ) : null}
          <Field label="Reason for rows without one" htmlFor="dnc-irs">
            <Select id="dnc-irs" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              {DNC_REASONS.map((r) => <option key={r} value={r}>{DNC_REASON_LABEL[r]}</option>)}
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ row, busy, run, onClose }: { row: DncRow; busy: boolean; run: Run; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const tooShort = reason.trim().length < 5;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent
        title={`Remove ${row.value} from do-not-contact?`}
        description="This contact can be messaged again. The entry and your reason are kept in the history and the audit log."
        footer={
          <>
            <Button onClick={onClose}>Keep on the list</Button>
            <Button variant="destructive" loading={busy} disabled={tooShort} onClick={() => run(() => removeDoNotContact(row.id, reason))}>
              Remove from do-not-contact
            </Button>
          </>
        }
      >
        <Field label="Why is it being removed?" htmlFor="dnc-why" hint="Required. For example: added by mistake, or the contact asked to hear from us again.">
          <Textarea id="dnc-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}
