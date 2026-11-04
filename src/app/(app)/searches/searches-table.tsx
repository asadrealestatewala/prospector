"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Radar } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import { SEARCH_STATUS } from "@/lib/engine/labels";
import { formatMoney, formatNumber, formatPkDateTime } from "@/lib/utils";

export type SearchRow = {
  id: string;
  name: string;
  product: Product;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  error: string | null;
  citiesTotal: number;
  citiesDone: number;
  saved: number;
  duplicates: number;
  costPkr: number;
};

export function SearchesTable({ rows }: { rows: SearchRow[] }) {
  const router = useRouter();
  const columns: Column<SearchRow>[] = [
    { key: "name", header: "Search", cell: (r) => <span className="font-medium">{r.name}</span>, value: (r) => r.name },
    { key: "product", header: "Product", cell: (r) => <ProductChip product={r.product} />, value: (r) => r.product },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusChip tone={SEARCH_STATUS[r.status]?.tone ?? "neutral"}>{SEARCH_STATUS[r.status]?.label ?? r.status}</StatusChip>,
      value: (r) => r.status,
    },
    {
      key: "cities",
      header: "Cities",
      cell: (r) => (
        <div className="flex min-w-32 items-center gap-2">
          <ProgressBar value={r.citiesDone} max={r.citiesTotal} isLimit={false} label={`${r.citiesDone} of ${r.citiesTotal} cities done`} />
          <span className="tabular whitespace-nowrap text-helper text-fg-muted">{r.citiesDone}/{r.citiesTotal}</span>
        </div>
      ),
      value: (r) => r.citiesDone / Math.max(1, r.citiesTotal),
    },
    { key: "saved", header: "Saved", numeric: true, cell: (r) => formatNumber(r.saved), value: (r) => r.saved },
    { key: "dupes", header: "Duplicates", numeric: true, cell: (r) => formatNumber(r.duplicates), value: (r) => r.duplicates },
    { key: "cost", header: "Google cost", numeric: true, cell: (r) => formatMoney(r.costPkr, "PKR"), value: (r) => r.costPkr },
    {
      key: "created",
      header: "Created",
      cell: (r) => (r.status === "scheduled" && r.scheduledAt ? `Starts ${formatPkDateTime(r.scheduledAt)}` : formatPkDateTime(r.createdAt)),
      value: (r) => r.createdAt,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/searches/${r.id}`)}
      empty={
        <EmptyState
          icon={Radar}
          message="No searches yet. Start one to find businesses on Google."
          action={
            <Button asChild variant="primary">
              <Link href="/searches/new">New search</Link>
            </Button>
          }
        />
      }
    />
  );
}
