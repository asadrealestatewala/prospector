"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, MessageCircle, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { formatPkDateTime } from "@/lib/utils";

export type TemplateRow = {
  id: string;
  name: string;
  product: Product;
  language: "en" | "ur";
  subject: string | null;
  is_starter: boolean;
  parent_template_id: string | null;
  archived_at: string | null;
  updated_at: string;
};

export const LANGUAGE_LABEL = { en: "English", ur: "Urdu" } as const;

/** SRS screen 9: email templates (WhatsApp templates arrive in step 6). */
export function TemplatesScreen({ rows, showArchived, loadError }: { rows: TemplateRow[]; showArchived: boolean; loadError: string | null }) {
  const router = useRouter();
  const [product, setProduct] = React.useState<"" | Product>("");
  const [language, setLanguage] = React.useState<"" | "en" | "ur">("");
  const shown = rows.filter((r) => (!product || r.product === product) && (!language || r.language === language));

  const columns: Column<TemplateRow>[] = [
    {
      key: "name",
      header: "Name",
      value: (r) => r.name,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/templates/email/${r.id}`} className="font-medium text-fg hover:text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.name}
          </Link>
          {r.is_starter ? <StatusChip tone="info">Starter</StatusChip> : null}
          {r.parent_template_id ? <StatusChip tone="neutral">B version</StatusChip> : null}
        </span>
      ),
    },
    { key: "product", header: "Product", value: (r) => r.product, cell: (r) => <ProductChip product={r.product} /> },
    { key: "language", header: "Language", value: (r) => LANGUAGE_LABEL[r.language], cell: (r) => LANGUAGE_LABEL[r.language] },
    { key: "subject", header: "Subject", value: (r) => r.subject, cell: (r) => <span className="line-clamp-1 text-fg-muted" dir={r.language === "ur" ? "rtl" : undefined}>{r.subject}</span> },
    { key: "updated", header: "Updated", value: (r) => r.updated_at, cell: (r) => <span className="text-fg-muted">{formatPkDateTime(r.updated_at)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Templates"
        description="Email and WhatsApp messages in English and Urdu. Every email gets the unsubscribe footer automatically."
        actions={
          <Button variant="primary" asChild>
            <Link href="/templates/email/new"><Plus /> New email template</Link>
          </Button>
        }
      />
      <Tabs defaultValue="email">
        <TabsList tabs={[{ value: "email", label: "Email templates" }, { value: "whatsapp", label: "WhatsApp templates" }]} />
        <TabsContent value="email" className="flex flex-col gap-4">
          {loadError ? <p className="rounded-control bg-error-soft px-3 py-2 text-body text-error" role="alert">{loadError}</p> : null}
          <DataTable
            rows={shown}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/templates/email/${r.id}`)}
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="tpl-product">Product</label>
                <Select id="tpl-product" className="w-40" value={product} onChange={(e) => setProduct(e.target.value as "" | Product)}>
                  <option value="">All products</option>
                  <option value="classwell">Classwell</option>
                  <option value="vetlin">Vetlin</option>
                  <option value="postwala">Postwala</option>
                </Select>
                <label className="sr-only" htmlFor="tpl-language">Language</label>
                <Select id="tpl-language" className="w-36" value={language} onChange={(e) => setLanguage(e.target.value as "" | "en" | "ur")}>
                  <option value="">All languages</option>
                  <option value="en">English</option>
                  <option value="ur">Urdu</option>
                </Select>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={showArchived ? "/templates" : "/templates?archived=1"}>{showArchived ? "Show active" : "Show archived"}</Link>
                </Button>
              </div>
            }
            empty={
              <EmptyState
                icon={FileText}
                message={showArchived ? "No archived templates." : product || language ? "No templates match these filters." : "No email templates yet. Start from a blank template."}
                action={!showArchived && !product && !language ? <Button variant="primary" asChild><Link href="/templates/email/new"><Plus /> New email template</Link></Button> : undefined}
              />
            }
          />
        </TabsContent>
        <TabsContent value="whatsapp">
          <Card>
            <EmptyState icon={MessageCircle} message="WhatsApp templates (category, header, buttons and approval status) are built in step 6 with the BotLinkd sender." />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
