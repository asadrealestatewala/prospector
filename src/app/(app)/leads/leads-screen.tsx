"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Ban, Bookmark, Columns3, Contact, Copy, Download, MailCheck, Mail, MessageCircle, Search, Tag, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PRODUCT_LABELS, ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { toast } from "@/components/ui/toaster";
import { LEAD_STATUS, LEAD_STATUSES, CONSENT_LABEL } from "@/lib/engine/labels";
import { FILTER_KEYS, filtersToParams, type LeadFilters } from "@/lib/leads/filters";
import { LEAD_COLUMN_LABELS, LEAD_COLUMNS_COOKIE } from "@/lib/leads/columns";
import { formatPkDate, formatPkDateTime } from "@/lib/utils";
import { addLeadsToDnc, addTags, assignOwner, changeStatus, deleteLeads, deleteView, saveView, verifyLeadEmails } from "./actions";

export type LeadRow = {
  id: string;
  name: string;
  product: Product;
  city: string | null;
  area: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  whatsapp: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  score: number;
  status: keyof typeof LEAD_STATUS;
  tags: string[];
  last_contacted_at: string | null;
  created_at: string;
  owner_id: string | null;
  source_search_id: string | null;
  ownerName: string | null;
  sourceName: string | null;
};

type View = { id: string; name: string; params: Partial<LeadFilters>; columns: string[]; is_shared: boolean; mine: boolean };

const SORT_KEY: Record<string, LeadFilters["sort"]> = {
  name: "name",
  city: "city",
  score: "score",
  rating: "google_rating",
  last_contacted: "last_contacted_at",
  status: "status",
  created: "created_at",
};

function shortUrl(u: string) {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

export function LeadsScreen({
  rows,
  total,
  loadError,
  filters,
  page,
  size,
  sort,
  owners,
  searches,
  cities,
  views,
  hidden: initialHidden,
  canDelete,
  canVerify,
}: {
  rows: LeadRow[];
  total: number;
  loadError: string | null;
  filters: LeadFilters;
  page: number;
  size: number;
  sort: { key: string; dir: "asc" | "desc" };
  owners: { id: string; full_name: string }[];
  searches: { id: string; name: string }[];
  cities: string[];
  views: View[];
  hidden: string[];
  canDelete: boolean;
  canVerify: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [hidden, setHidden] = React.useState(initialHidden);
  const [q, setQ] = React.useState(filters.q ?? "");
  const [dialog, setDialog] = React.useState<null | { kind: "owner" | "status" | "tags" | "dnc" | "delete"; ids: string[] }>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  function navigate(next: Partial<LeadFilters>, resetPage = true) {
    const merged: Partial<LeadFilters> = { ...filters, ...next };
    if (resetPage) delete merged.page;
    router.replace(`${pathname}?${filtersToParams(merged).toString()}`, { scroll: false });
  }
  function setFilter(key: keyof LeadFilters, value: string | undefined) {
    navigate({ [key]: value || undefined } as Partial<LeadFilters>);
  }

  // Search box applies after a short pause in typing.
  React.useEffect(() => {
    if ((filters.q ?? "") === q) return;
    const t = setTimeout(() => setFilter("q", q.trim() || undefined), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function setColumns(next: string[]) {
    setHidden(next);
    document.cookie = `${LEAD_COLUMNS_COOKIE}=${next.join(".")}; path=/; max-age=31536000; samesite=lax`;
  }

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      toast.success(r.message ?? "Done.");
      setDialog(null);
      router.refresh();
    } else toast.error(r.error ?? "Something went wrong.");
  }

  const exportHref = (ids?: string[]) => {
    const p = filtersToParams({ ...filters, page: undefined, size: undefined });
    if (ids?.length) p.set("ids", ids.join(","));
    p.set("columns", Object.keys(LEAD_COLUMN_LABELS).filter((c) => !hidden.includes(c)).join("."));
    return `/leads/export?${p.toString()}`;
  };

  const active = FILTER_KEYS.filter((k) => filters[k] !== undefined).map((k) => ({ key: k, label: filterLabel(k, filters, owners, searches) }));

  const columns: Column<LeadRow>[] = [
    {
      key: "name",
      header: "Business name",
      value: (r) => r.name,
      cell: (r) => (
        <Link href={`/leads/${r.id}`} className="block max-w-64 truncate font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
          {r.name}
        </Link>
      ),
    },
    { key: "product", header: "Product", sortable: false, value: (r) => PRODUCT_LABELS[r.product], cell: (r) => <ProductChip product={r.product} /> },
    { key: "city", header: "City", value: (r) => r.city, cell: (r) => <span className="whitespace-nowrap">{r.city}{r.area ? <span className="text-fg-muted">, {r.area}</span> : null}</span> },
    { key: "phone", header: "Phone", sortable: false, value: (r) => r.phone, cell: (r) => <span className="tabular whitespace-nowrap">{r.phone ?? "—"}</span> },
    {
      key: "website",
      sortable: false,
      header: "Website",
      value: (r) => r.website,
      cell: (r) =>
        r.website ? (
          <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-44 truncate text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>
            {shortUrl(r.website)}
          </a>
        ) : (
          "—"
        ),
    },
    { key: "email", header: "Email", sortable: false, value: (r) => r.email, cell: (r) => <span className="block max-w-52 truncate">{r.email ?? "—"}</span> },
    { key: "whatsapp", header: "WhatsApp", sortable: false, value: (r) => r.whatsapp, cell: (r) => <span className="tabular whitespace-nowrap">{r.whatsapp ?? "—"}</span> },
    { key: "rating", header: "Rating", numeric: true, value: (r) => r.google_rating, cell: (r) => (r.google_rating ? `${Number(r.google_rating).toFixed(1)} (${r.google_review_count ?? 0})` : "—") },
    { key: "score", header: "Score", numeric: true, value: (r) => r.score, cell: (r) => <span className="tabular font-medium">{r.score}</span> },
    { key: "status", header: "Status", value: (r) => r.status, cell: (r) => <StatusChip tone={LEAD_STATUS[r.status].tone}>{LEAD_STATUS[r.status].label}</StatusChip> },
    { key: "source", header: "Source search", sortable: false, value: (r) => r.sourceName, cell: (r) => <span className="block max-w-44 truncate text-fg-muted">{r.sourceName ?? "Manual"}</span> },
    { key: "last_contacted", header: "Last contacted", value: (r) => r.last_contacted_at, cell: (r) => (r.last_contacted_at ? formatPkDateTime(r.last_contacted_at) : "Never") },
    { key: "owner", header: "Owner", sortable: false, value: (r) => r.ownerName, cell: (r) => r.ownerName ?? <span className="text-fg-muted">Unassigned</span> },
    { key: "tags", header: "Tags", sortable: false, value: (r) => r.tags.join(" "), cell: (r) => <span className="block max-w-44 truncate text-helper">{r.tags.join(", ") || "—"}</span> },
    { key: "created", header: "Date added", value: (r) => r.created_at, cell: (r) => formatPkDate(r.created_at) },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${total.toLocaleString("en-PK")} ${total === 1 ? "lead" : "leads"}${active.length ? " match these filters" : ""}`}
        actions={
          <>
            <Button asChild>
              <Link href="/leads/duplicates">
                <Copy /> Find duplicates
              </Link>
            </Button>
            <Button asChild variant="primary">
              <a href={exportHref()}>
                <Download /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input aria-label="Search leads" placeholder="Search name, phone, email or website" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <FilterSelect label="Product" value={filters.product} onChange={(v) => setFilter("product", v)} options={(Object.keys(PRODUCT_LABELS) as Product[]).map((p) => [p, PRODUCT_LABELS[p]])} />
        <FilterSelect label="City" value={filters.city} onChange={(v) => setFilter("city", v)} options={cities.map((c) => [c, c])} />
        <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter("status", v)} options={LEAD_STATUSES.map((s) => [s, LEAD_STATUS[s].label])} />
        <FilterSelect label="Email" value={filters.has_email} onChange={(v) => setFilter("has_email", v)} options={[["1", "Has email"], ["0", "No email"]]} />
        <FilterSelect label="WhatsApp" value={filters.has_whatsapp} onChange={(v) => setFilter("has_whatsapp", v)} options={[["1", "Has WhatsApp"], ["0", "No WhatsApp"]]} />
        <FilterSelect label="Website" value={filters.has_website} onChange={(v) => setFilter("has_website", v)} options={[["1", "Has website"], ["0", "No website"]]} />
        <FilterSelect label="Consent" value={filters.consent} onChange={(v) => setFilter("consent", v)} options={Object.entries(CONSENT_LABEL)} />
        <FilterSelect label="Source search" value={filters.search} onChange={(v) => setFilter("search", v)} options={searches.map((s) => [s.id, s.name])} />
        <FilterSelect label="Owner" value={filters.owner} onChange={(v) => setFilter("owner", v)} options={[["none", "Unassigned"], ...owners.map((o) => [o.id, o.full_name] as [string, string])]} />
        <MoreFilters filters={filters} onApply={(f) => navigate(f)} />
        <div className="ml-auto flex gap-2">
          <ViewsMenu views={views} onLoad={(v) => { if (v.columns.length) setColumns(Object.keys(LEAD_COLUMN_LABELS).filter((c) => !v.columns.includes(c))); router.replace(`${pathname}?${filtersToParams(v.params).toString()}`); }} onSave={() => setSaveOpen(true)} onDelete={(id) => run(() => deleteView(id))} />
          <ColumnChooser hidden={hidden} onChange={setColumns} />
        </div>
      </div>

      {active.length ? (
        <div className="mb-3">
          <FilterBar active={active} onRemove={(k) => { if (k === "q") setQ(""); setFilter(k as keyof LeadFilters, undefined); }}>
            <Button variant="link" size="sm" onClick={() => { setQ(""); router.replace(pathname); }}>
              Clear all
            </Button>
          </FilterBar>
        </div>
      ) : null}

      {loadError ? <p role="alert" className="mb-3 rounded-control bg-error-soft px-3 py-2 text-body text-error">{loadError}</p> : null}

      <DataTable
        rows={rows}
        columns={columns}
        hiddenColumns={hidden}
        rowKey={(r) => r.id}
        selectable
        onRowClick={(r) => router.push(`/leads/${r.id}`)}
        manual={{
          total,
          page,
          pageSize: size,
          sort: { key: Object.entries(SORT_KEY).find(([, v]) => v === sort.key)?.[0] ?? sort.key, dir: sort.dir },
          onPage: (p) => navigate({ page: p }, false),
          onPageSize: (s) => navigate({ size: s as LeadFilters["size"] }),
          onSort: (s) => {
            const key = SORT_KEY[s.key];
            if (key) navigate({ sort: key, dir: s.dir });
            else toast.info("This column cannot be sorted.");
          },
        }}
        bulkActions={(sel) => {
          const ids = sel.map((r) => r.id);
          return (
            <>
              <Button size="sm" disabled title="Email campaigns arrive in step 5">
                <Mail /> Add to email campaign
              </Button>
              <Button size="sm" disabled title="WhatsApp campaigns arrive in step 6">
                <MessageCircle /> Add to WhatsApp campaign
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "owner", ids })}>
                <UserRound /> Assign owner
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "status", ids })}>Change status</Button>
              <Button size="sm" onClick={() => setDialog({ kind: "tags", ids })}>
                <Tag /> Add tags
              </Button>
              {canVerify ? (
                <Button size="sm" loading={busy} disabled={busy} onClick={() => run(() => verifyLeadEmails(ids))}>
                  <MailCheck /> Verify emails
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setDialog({ kind: "dnc", ids })}>
                <Ban /> Add to do-not-contact
              </Button>
              <Button size="sm" asChild>
                <a href={exportHref(ids)}>
                  <Download /> Export CSV
                </a>
              </Button>
              {canDelete ? (
                <Button size="sm" variant="destructive" onClick={() => setDialog({ kind: "delete", ids })}>
                  <Trash2 /> Delete
                </Button>
              ) : null}
            </>
          );
        }}
        empty={
          <EmptyState
            icon={Contact}
            message={active.length ? "No leads match these filters." : "No leads yet. Run a search to find businesses."}
            action={
              active.length ? (
                <Button onClick={() => { setQ(""); router.replace(pathname); }}>Clear filters</Button>
              ) : (
                <Button asChild variant="primary">
                  <Link href="/searches/new">New search</Link>
                </Button>
              )
            }
          />
        }
      />

      <BulkDialogs dialog={dialog} setDialog={setDialog} owners={owners} busy={busy} run={run} />
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={(name, shared) =>
          run(async () => {
            const params: Partial<LeadFilters> = { ...filters };
            delete params.page;
            const r = await saveView({ name, params, columns: Object.keys(LEAD_COLUMN_LABELS).filter((c) => !hidden.includes(c)), shared });
            if (r.ok) setSaveOpen(false);
            return r;
          })
        }
      />
    </>
  );
}

function filterLabel(k: (typeof FILTER_KEYS)[number], f: LeadFilters, owners: { id: string; full_name: string }[], searches: { id: string; name: string }[]): string {
  const v = String(f[k]);
  switch (k) {
    case "q": return `Search: ${v}`;
    case "product": return PRODUCT_LABELS[v as Product];
    case "status": return LEAD_STATUS[v as keyof typeof LEAD_STATUS]?.label ?? v;
    case "has_email": return v === "1" ? "Has email" : "No email";
    case "has_whatsapp": return v === "1" ? "Has WhatsApp" : "No WhatsApp";
    case "has_website": return v === "1" ? "Has website" : "No website";
    case "score_min": return `Score from ${v}`;
    case "score_max": return `Score up to ${v}`;
    case "search": return `Search: ${searches.find((s) => s.id === v)?.name ?? "selected"}`;
    case "owner": return v === "none" ? "Unassigned" : `Owner: ${owners.find((o) => o.id === v)?.full_name ?? "selected"}`;
    case "tag": return `Tag: ${v}`;
    case "from": return `Added from ${formatPkDate(v)}`;
    case "to": return `Added up to ${formatPkDate(v)}`;
    case "consent": return `Consent: ${CONSENT_LABEL[v] ?? v}`;
    default: return `${k}: ${v}`;
  }
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; options: [string, string][] }) {
  return (
    <Select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="h-9 w-auto max-w-44">
      <option value="">{label}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </Select>
  );
}

function MoreFilters({ filters, onApply }: { filters: LeadFilters; onApply: (f: Partial<LeadFilters>) => void }) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ score_min: "", score_max: "", from: "", to: "", tag: "" });
  return (
    <>
      <Button
        onClick={() => {
          setF({
            score_min: filters.score_min?.toString() ?? "",
            score_max: filters.score_max?.toString() ?? "",
            from: filters.from ?? "",
            to: filters.to ?? "",
            tag: filters.tag ?? "",
          });
          setOpen(true);
        }}
      >
        More filters
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="More filters"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  onApply({
                    score_min: f.score_min === "" ? undefined : Number(f.score_min),
                    score_max: f.score_max === "" ? undefined : Number(f.score_max),
                    from: f.from || undefined,
                    to: f.to || undefined,
                    tag: f.tag.trim().toLowerCase() || undefined,
                  });
                  setOpen(false);
                }}
              >
                Apply filters
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Score from" htmlFor="smin"><Input id="smin" type="number" min={0} value={f.score_min} onChange={(e) => setF({ ...f, score_min: e.target.value })} /></Field>
            <Field label="Score up to" htmlFor="smax"><Input id="smax" type="number" min={0} value={f.score_max} onChange={(e) => setF({ ...f, score_max: e.target.value })} /></Field>
            <Field label="Date added from" htmlFor="dfrom"><Input id="dfrom" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="Date added up to" htmlFor="dto"><Input id="dto" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
            <Field label="Tag" htmlFor="ftag" className="sm:col-span-2"><Input id="ftag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} maxLength={40} /></Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const menuItem = "flex h-9 cursor-pointer select-none items-center gap-2 rounded-control px-3 text-body outline-none data-[highlighted]:bg-brand-50";

function ColumnChooser({ hidden, onChange }: { hidden: string[]; onChange: (h: string[]) => void }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <Button size="icon" aria-label="Choose columns" title="Choose columns">
          <Columns3 />
        </Button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 max-h-96 w-56 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-float">
          <DM.Label className="px-3 py-1.5 text-helper font-semibold text-fg-muted">Columns</DM.Label>
          {Object.entries(LEAD_COLUMN_LABELS).map(([key, label]) => (
            <DM.CheckboxItem
              key={key}
              disabled={key === "name"}
              checked={!hidden.includes(key)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onChange(on ? hidden.filter((h) => h !== key) : [...hidden, key])}
              className={`${menuItem} data-[disabled]:opacity-50`}
            >
              <span className="grid size-4 place-items-center rounded border border-border">
                <DM.ItemIndicator>✓</DM.ItemIndicator>
              </span>
              {label}
            </DM.CheckboxItem>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function ViewsMenu({ views, onLoad, onSave, onDelete }: { views: View[]; onLoad: (v: View) => void; onSave: () => void; onDelete: (id: string) => void }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <Button>
          <Bookmark /> Saved views
        </Button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 max-h-96 w-64 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-float">
          {views.length === 0 ? <p className="px-3 py-2 text-helper text-fg-muted">No saved views yet.</p> : null}
          {views.map((v) => (
            <div key={v.id} className="flex items-center">
              <DM.Item className={`${menuItem} min-w-0 flex-1`} onSelect={() => onLoad(v)}>
                <span className="truncate">{v.name}</span>
                {v.is_shared ? <span className="ml-auto text-helper text-fg-muted">Shared</span> : null}
              </DM.Item>
              {v.mine ? (
                <button type="button" aria-label={`Delete view ${v.name}`} className="grid size-8 place-items-center rounded-control text-fg-muted hover:bg-neutral-soft" onClick={() => onDelete(v.id)}>
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
          <DM.Separator className="my-1 h-px bg-border" />
          <DM.Item className={menuItem} onSelect={onSave}>
            <Bookmark className="size-4" /> Save current view
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function SaveViewDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (name: string, shared: boolean) => void }) {
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Save this view"
        description="Saves the current filters, sort and columns."
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), shared)}>Save view</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="View name" htmlFor="vname"><Input id="vname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 accent-[var(--brand-600)]" />
            Share with the team
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkDialogs({
  dialog,
  setDialog,
  owners,
  busy,
  run,
}: {
  dialog: null | { kind: "owner" | "status" | "tags" | "dnc" | "delete"; ids: string[] };
  setDialog: (d: null) => void;
  owners: { id: string; full_name: string }[];
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => Promise<void>;
}) {
  const [owner, setOwner] = React.useState("");
  const [status, setStatus] = React.useState<string>("contacted");
  const [reason, setReason] = React.useState("");
  const [tags, setTags] = React.useState("");
  const n = dialog?.ids.length ?? 0;
  const count = `${n.toLocaleString("en-PK")} ${n === 1 ? "lead" : "leads"}`;
  const close = (o: boolean) => (!o ? setDialog(null) : null);

  if (!dialog) return null;
  if (dialog.kind === "delete") {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title={`Delete ${count}?`}
        description="Their contacts, notes and history are deleted too. This cannot be undone. Do-not-contact entries are kept."
        confirmLabel={`Delete ${count}`}
        destructive
        loading={busy}
        onConfirm={() => run(() => deleteLeads(dialog.ids))}
      />
    );
  }
  if (dialog.kind === "dnc") {
    return (
      <Dialog open onOpenChange={close}>
        <DialogContent
          title={`Add ${count} to do-not-contact?`}
          description="Every email, phone and WhatsApp number on these leads will never be messaged. Only an Admin can remove them later."
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => run(() => addLeadsToDnc(dialog.ids, reason))}>Add to do-not-contact</Button>
            </>
          }
        >
          <Field label="Reason (optional)" htmlFor="dncr"><Input id="dncr" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={close}>
      <DialogContent
        title={dialog.kind === "owner" ? `Assign owner for ${count}` : dialog.kind === "status" ? `Change status for ${count}` : `Add tags to ${count}`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={dialog.kind === "tags" && !tags.trim()}
              onClick={() =>
                run(() =>
                  dialog.kind === "owner"
                    ? assignOwner(dialog.ids, owner || null)
                    : dialog.kind === "status"
                      ? changeStatus(dialog.ids, status, reason)
                      : addTags(dialog.ids, tags.split(",").map((t) => t.trim()).filter(Boolean)),
                )
              }
            >
              {dialog.kind === "owner" ? "Assign owner" : dialog.kind === "status" ? "Change status" : "Add tags"}
            </Button>
          </>
        }
      >
        {dialog.kind === "owner" ? (
          <Field label="Owner" htmlFor="bo">
            <Select id="bo" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Nobody (unassign)</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </Select>
          </Field>
        ) : dialog.kind === "status" ? (
          <div className="flex flex-col gap-3">
            <Field label="New status" htmlFor="bs">
              <Select id="bs" value={status} onChange={(e) => setStatus(e.target.value)}>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS[s].label}</option>)}
              </Select>
            </Field>
            <Field label="Reason (optional)" htmlFor="br" hint={status === "lost" ? "Recording why a lead was lost helps the Results report." : undefined}>
              <Input id="br" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </Field>
          </div>
        ) : (
          <Field label="Tags" htmlFor="bt" hint="Separate tags with commas.">
            <Input id="bt" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        )}
      </DialogContent>
    </Dialog>
  );
}
