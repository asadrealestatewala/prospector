"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Value used for sorting and CSV export. */
  value?: (row: T) => string | number | null;
  numeric?: boolean;
  className?: string;
  /** Set false when the server cannot sort by this column. */
  sortable?: boolean;
};

function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const cols = columns.filter((c) => c.value);
  return [cols.map((c) => esc(c.header)).join(","), ...rows.map((r) => cols.map((c) => esc(c.value!(r))).join(","))].join("\n");
}

/**
 * Data table from SRS 4A: 44 px rows, sticky header, hover brand-50, selected brand-100,
 * checkbox column, sortable headers, pagination with page size choice, CSV export.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selectable,
  onRowClick,
  toolbar,
  exportName,
  onExport,
  empty,
  bulkActions,
  initialPageSize = 25,
  manual,
  hiddenColumns,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  selectable?: boolean;
  onRowClick?: (row: T) => void;
  toolbar?: React.ReactNode;
  exportName?: string;
  onExport?: (count: number) => void;
  empty?: React.ReactNode;
  bulkActions?: (selected: T[]) => React.ReactNode;
  initialPageSize?: number;
  /**
   * Server-side paging and sorting for large tables (Leads): rows are already the current page,
   * sorted by the server; the table reports page, size and sort changes instead.
   */
  manual?: {
    total: number;
    page: number;
    pageSize: number;
    sort: { key: string; dir: "asc" | "desc" } | null;
    onPage: (page: number) => void;
    onPageSize: (size: number) => void;
    onSort: (sort: { key: string; dir: "asc" | "desc" }) => void;
  };
  hiddenColumns?: string[];
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const shown = hiddenColumns?.length ? columns.filter((c) => !hiddenColumns.includes(c.key)) : columns;
  const activeSort = manual ? manual.sort : sort;
  const sorted = React.useMemo(() => {
    if (manual || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const r = av < bv ? -1 : 1;
      return sort.dir === "asc" ? r : -r;
    });
    return copy;
  }, [rows, columns, sort, manual]);

  const size = manual ? manual.pageSize : pageSize;
  const total = manual ? manual.total : sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(manual ? manual.page : page, pageCount - 1);
  const visible = manual ? rows : sorted.slice(current * size, current * size + size);
  const goPage = (p: number) => (manual ? manual.onPage(p) : setPage(p));
  const toggleSort = (key: string) => {
    const next = activeSort?.key === key && activeSort.dir === "asc" ? { key, dir: "desc" as const } : { key, dir: "asc" as const };
    if (manual) manual.onSort(next);
    else setSort(next);
  };
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(rowKey(r)));

  function toggleAll() {
    const next = new Set(selected);
    visible.forEach((r) => (allVisibleSelected ? next.delete(rowKey(r)) : next.add(rowKey(r))));
    setSelected(next);
  }

  function exportCsv() {
    const data = selectedRows.length ? selectedRows : sorted;
    const blob = new Blob([toCsv(data, shown)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    onExport?.(data.length);
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      {(toolbar || exportName || (bulkActions && selectedRows.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {selectedRows.length > 0 && bulkActions ? (
            <>
              <span className="text-body font-medium">{selectedRows.length} selected</span>
              {bulkActions(selectedRows)}
            </>
          ) : (
            toolbar
          )}
          {exportName ? (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={exportCsv}>
              <Download /> Export CSV
            </Button>
          ) : null}
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-body">
          <thead className="sticky top-0 z-10 bg-neutral-soft">
            <tr>
              {selectable ? (
                <th className="w-11 border-b border-border px-3 text-left">
                  <input type="checkbox" aria-label="Select all rows on this page" checked={allVisibleSelected} onChange={toggleAll} className="size-4 accent-[var(--brand-600)]" />
                </th>
              ) : null}
              {shown.map((c) => {
                const active = activeSort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (activeSort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("h-11 whitespace-nowrap border-b border-border px-3 text-left text-helper font-semibold text-fg-muted", c.numeric && "text-right", c.className)}
                  >
                    {c.value && c.sortable !== false ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-fg"
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.header}
                        {active ? activeSort!.dir === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" /> : <ArrowUpDown className="size-4 opacity-40" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={shown.length + (selectable ? 1 : 0)}>{empty}</td>
              </tr>
            ) : (
              visible.map((r) => {
                const id = rowKey(r);
                const isSel = selected.has(id);
                return (
                  <tr
                    key={id}
                    className={cn("h-11 border-b border-border last:border-b-0 hover:bg-brand-50", isSel && "bg-brand-100 hover:bg-brand-100", onRowClick && "cursor-pointer")}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                  >
                    {selectable ? (
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={isSel}
                          className="size-4 accent-[var(--brand-600)]"
                          onChange={() => {
                            const next = new Set(selected);
                            if (isSel) next.delete(id);
                            else next.add(id);
                            setSelected(next);
                          }}
                        />
                      </td>
                    ) : null}
                    {shown.map((c) => (
                      <td key={c.key} className={cn("px-3", c.numeric && "tabular text-right", c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-helper text-fg-muted">
        <label className="flex items-center gap-2">
          Rows per page
          <Select className="h-8 w-20" value={size} onChange={(e) => { if (manual) manual.onPageSize(Number(e.target.value)); else { setPageSize(Number(e.target.value)); setPage(0); } }}>
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </label>
        <div className="flex items-center gap-2">
          <span className="tabular">
            {total === 0 ? 0 : current * size + 1}–{Math.min(total, (current + 1) * size)} of {total.toLocaleString("en-PK")}
          </span>
          <Button variant="ghost" size="icon" aria-label="Previous page" disabled={current === 0} onClick={() => goPage(current - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next page" disabled={current >= pageCount - 1} onClick={() => goPage(current + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
