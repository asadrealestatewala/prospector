"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Download, ScrollText, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/input";
import {
  CHANNEL_LABEL, CHANNELS, CONSENT_EVENT_LABEL, CONSENT_EVENTS, CONSENT_SOURCE_LABEL, CONSENT_SOURCES,
  type ConsentFilters,
} from "@/lib/compliance/filters";
import { formatPkDateTime } from "@/lib/utils";

export type ConsentRow = {
  id: string;
  occurred_at: string;
  lead_id: string | null;
  lead_name: string | null;
  product: Product | null;
  channel: (typeof CHANNELS)[number];
  value: string;
  event: (typeof CONSENT_EVENTS)[number];
  source: (typeof CONSENT_SOURCES)[number];
  source_url: string | null;
  note: string | null;
  recorded_by_name: string | null;
  recorded_by_system: string | null;
};

/** SRS screen 15: proof of where each contact came from, with opt-in and opt-out events. */
export function ConsentScreen({ rows, total, filters, page, size, leadName, loadError }: {
  rows: ConsentRow[]; total: number; filters: ConsentFilters; page: number; size: number; leadName: string | null; loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState(filters.q ?? "");

  function navigate(next: Partial<ConsentFilters>, resetPage = true) {
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

  const active = [
    filters.lead ? { key: "lead", label: `Lead: ${leadName ?? "selected"}` } : null,
    filters.channel ? { key: "channel", label: CHANNEL_LABEL[filters.channel] } : null,
    filters.event ? { key: "event", label: CONSENT_EVENT_LABEL[filters.event] } : null,
    filters.source ? { key: "source", label: CONSENT_SOURCE_LABEL[filters.source] } : null,
    filters.from ? { key: "from", label: `From ${filters.from}` } : null,
    filters.to ? { key: "to", label: `To ${filters.to}` } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const exportParams = new URLSearchParams();
  for (const k of ["q", "channel", "event", "source", "lead", "from", "to"] as const) if (filters[k]) exportParams.set(k, String(filters[k]));

  const columns: Column<ConsentRow>[] = [
    { key: "at", header: "Date", sortable: false, cell: (r) => <span className="whitespace-nowrap text-helper">{formatPkDateTime(r.occurred_at)}</span> },
    {
      key: "lead",
      header: "Lead",
      sortable: false,
      cell: (r) =>
        r.lead_id ? (
          <span className="flex items-center gap-2">
            {r.product ? <ProductChip product={r.product} /> : null}
            <Link href={`/leads/${r.lead_id}`} className="text-brand-600 hover:underline">{r.lead_name}</Link>
          </span>
        ) : (
          <span className="text-fg-muted">No lead</span>
        ),
    },
    { key: "value", header: "Contact", sortable: false, cell: (r) => <span className="tabular break-all">{r.value}</span> },
    { key: "channel", header: "Channel", sortable: false, cell: (r) => CHANNEL_LABEL[r.channel] },
    {
      key: "event",
      header: "Event",
      sortable: false,
      cell: (r) => <StatusChip tone={r.event === "opt_out" ? "error" : r.event === "opt_in" ? "success" : "neutral"}>{CONSENT_EVENT_LABEL[r.event]}</StatusChip>,
    },
    {
      key: "source",
      header: "Source",
      sortable: false,
      cell: (r) => (
        <div className="text-helper">
          <p>{CONSENT_SOURCE_LABEL[r.source]}</p>
          {r.source_url ? <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-64 truncate text-brand-600 hover:underline">{r.source_url}</a> : null}
          {r.note ? <p className="text-fg-muted">{r.note}</p> : null}
        </div>
      ),
    },
    { key: "by", header: "Recorded by", sortable: false, cell: (r) => <span className="text-helper">{r.recorded_by_name ?? systemName(r.recorded_by_system)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Consent Log"
        description="Where each contact came from and every opt-in or opt-out. Entries cannot be changed or deleted."
        actions={
          <Button variant={filters.lead ? "primary" : "secondary"} asChild>
            <a href={`/consent-log/export?${exportParams.toString()}`}><Download /> {filters.lead ? "Export for this lead" : "Export CSV"}</a>
          </Button>
        }
      />
      {loadError ? <p className="mb-4 text-body text-error">{loadError}</p> : null}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        manual={{ total, page, pageSize: size, sort: null, onPage: (p) => navigate({ page: p }, false), onPageSize: (s) => navigate({ size: s }), onSort: () => undefined }}
        toolbar={
          <FilterBar active={active} onRemove={(k) => navigate({ [k]: undefined } as Partial<ConsentFilters>)}>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <label htmlFor="cl-q" className="sr-only">Search contact or lead</label>
              <Input id="cl-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contact or lead" className="pl-9" />
            </div>
            <label htmlFor="cl-channel" className="sr-only">Channel</label>
            <Select id="cl-channel" className="w-auto" value={filters.channel ?? ""} onChange={(e) => navigate({ channel: (e.target.value || undefined) as ConsentFilters["channel"] })}>
              <option value="">All channels</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </Select>
            <label htmlFor="cl-event" className="sr-only">Event</label>
            <Select id="cl-event" className="w-auto" value={filters.event ?? ""} onChange={(e) => navigate({ event: (e.target.value || undefined) as ConsentFilters["event"] })}>
              <option value="">All events</option>
              {CONSENT_EVENTS.map((c) => <option key={c} value={c}>{CONSENT_EVENT_LABEL[c]}</option>)}
            </Select>
            <label htmlFor="cl-source" className="sr-only">Source</label>
            <Select id="cl-source" className="w-auto" value={filters.source ?? ""} onChange={(e) => navigate({ source: (e.target.value || undefined) as ConsentFilters["source"] })}>
              <option value="">All sources</option>
              {CONSENT_SOURCES.map((c) => <option key={c} value={c}>{CONSENT_SOURCE_LABEL[c]}</option>)}
            </Select>
            <label htmlFor="cl-from" className="sr-only">From date</label>
            <Input id="cl-from" type="date" className="w-auto" value={filters.from ?? ""} onChange={(e) => navigate({ from: e.target.value || undefined })} />
            <label htmlFor="cl-to" className="sr-only">To date</label>
            <Input id="cl-to" type="date" className="w-auto" value={filters.to ?? ""} onChange={(e) => navigate({ to: e.target.value || undefined })} />
          </FilterBar>
        }
        empty={<EmptyState icon={ScrollText} message={active.length || filters.q ? "No consent records match these filters." : "No consent records yet. They are added as leads and contacts are collected."} />}
      />
    </>
  );
}

function systemName(s: string | null) {
  if (s === "places-search") return "Google search";
  if (s === "website-crawl") return "Website crawler";
  return s ?? "System";
}
