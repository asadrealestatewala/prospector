"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProductChip, type Product } from "@/components/ui/chips";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber, formatPkDateTime } from "@/lib/utils";
import { CampaignStatusChip, type CampaignStatus, type Counts } from "./status";

export type CampaignListRow = {
  id: string;
  name: string;
  product: Product;
  status: CampaignStatus;
  audience_size: number;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string;
  paused_reason: string | null;
  counts: Counts;
};

/** SRS screen 7 list view. Counters refresh every 15 seconds while a campaign is sending. */
export function CampaignList({ rows, loadError }: { rows: CampaignListRow[]; loadError: string | null }) {
  const router = useRouter();
  const live = rows.some((r) => r.status === "sending" || r.status === "scheduled");
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);

  const num = (key: keyof Counts, header: string): Column<CampaignListRow> => ({
    key, header, numeric: true, value: (r) => r.counts[key], cell: (r) => formatNumber(r.counts[key]),
  });
  const columns: Column<CampaignListRow>[] = [
    {
      key: "name", header: "Name", value: (r) => r.name,
      cell: (r) => (
        <span className="flex flex-col">
          <Link href={`/campaigns/email/${r.id}`} className="font-medium text-fg hover:text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link>
          <span className="text-helper text-fg-muted">{r.status === "scheduled" && r.scheduled_at ? `Starts ${formatPkDateTime(r.scheduled_at)}` : `Created ${formatPkDateTime(r.created_at)}`}</span>
        </span>
      ),
    },
    { key: "product", header: "Product", value: (r) => r.product, cell: (r) => <ProductChip product={r.product} /> },
    { key: "audience", header: "Audience", numeric: true, value: (r) => r.audience_size, cell: (r) => formatNumber(r.audience_size) },
    { key: "status", header: "Status", value: (r) => r.status, cell: (r) => <CampaignStatusChip status={r.status} title={r.paused_reason ?? undefined} /> },
    num("sent", "Sent"),
    num("delivered", "Delivered"),
    num("opened", "Opened"),
    num("clicked", "Clicked"),
    num("replied", "Replied"),
    num("bounced", "Bounced"),
    num("unsubscribed", "Unsubscribed"),
  ];

  return (
    <>
      <PageHeader
        title="Email Campaigns"
        description="Daily limits, sending hours in Pakistan time, and safeguards on every send."
        actions={<Button variant="primary" asChild><Link href="/campaigns/email/new"><Plus /> New email campaign</Link></Button>}
      />
      {loadError ? <p className="mb-4 rounded-control bg-error-soft px-3 py-2 text-body text-error" role="alert">{loadError}</p> : null}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/campaigns/email/${r.id}`)}
        exportName="email-campaigns"
        empty={<EmptyState icon={Mail} message="No email campaigns yet. Create one, or select leads on the Leads screen and add them to a campaign." action={<Button variant="primary" asChild><Link href="/campaigns/email/new"><Plus /> New email campaign</Link></Button>} />}
      />
    </>
  );
}
