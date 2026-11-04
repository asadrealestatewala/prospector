"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, ExternalLink, Pause, Play, RotateCcw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProductChip, StatusChip, type Product } from "@/components/ui/chips";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toaster";
import { SEARCH_STATUS } from "@/lib/engine/labels";
import { cn, formatMoney, formatNumber, formatPkDateTime } from "@/lib/utils";
import { cancelSearch, pauseSearch, retryCrawl, startSearch } from "../actions";
import { LiveRefresh } from "../live-refresh";

export type Progress = {
  cities_total: number;
  cities_done: number;
  found: number;
  saved: number;
  duplicates: number;
  api_calls: number;
  websites_queued: number;
  websites_crawled: number;
  failed_crawls: number;
  emails_found: number;
  whatsapp_found: number;
};

type Search = {
  id: string;
  name: string;
  product: Product;
  status: string;
  keywords: string[];
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  scheduled_at: string | null;
  estimated_calls: number;
  estimated_cost_pkr: number;
  actual_calls: number;
  actual_cost_pkr: number;
};
type City = { id: string; city: string; area: string | null; status: string; found_count: number; saved_count: number; duplicate_count: number; api_calls: number; keyword_index: number; error: string | null };
type FeedLead = { id: string; name: string; city: string | null; area: string | null; phone: string | null; website: string | null; google_rating: number | null; created_at: string };
type Failure = { id: string; url: string; status: string; error_reason: string | null; retries: number; finished_at: string | null; lead_id: string; leadName: string | null };

export function LiveProgress({
  search,
  cities,
  progress,
  feed,
  failures,
  canControl,
}: {
  search: Search;
  cities: City[];
  progress: Progress;
  feed: FeedLead[];
  failures: Failure[];
  canControl: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [live, setLive] = React.useState(false);
  const onStatus = React.useCallback((v: boolean) => setLive(v), []);
  const status = SEARCH_STATUS[search.status] ?? { label: search.status, tone: "neutral" as const };
  const active = ["queued", "running"].includes(search.status);
  const canResume = ["paused", "draft", "failed"].includes(search.status);
  const keywords = search.keywords.length || 1;

  async function run(label: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(r.message ?? "Done.");
    else toast.error(r.error ?? "Something went wrong.");
    router.refresh();
  }

  const counters: { label: string; value: string }[] = [
    { label: "Cities completed", value: `${formatNumber(progress.cities_done ?? 0)} of ${formatNumber(progress.cities_total ?? 0)}` },
    { label: "Businesses found", value: formatNumber(progress.found ?? 0) },
    { label: "Saved as leads", value: formatNumber(progress.saved ?? 0) },
    { label: "Duplicates skipped", value: formatNumber(progress.duplicates ?? 0) },
    { label: "Websites queued", value: formatNumber(progress.websites_queued ?? 0) },
    { label: "Websites crawled", value: formatNumber(progress.websites_crawled ?? 0) },
    { label: "Emails found", value: formatNumber(progress.emails_found ?? 0) },
    { label: "WhatsApp numbers found", value: formatNumber(progress.whatsapp_found ?? 0) },
    { label: "Failed crawls", value: formatNumber(progress.failed_crawls ?? 0) },
  ];

  return (
    <>
      <LiveRefresh
        channel={`search-${search.id}`}
        onStatus={onStatus}
        tables={[
          { table: "searches", filter: `id=eq.${search.id}` },
          { table: "search_cities", filter: `search_id=eq.${search.id}` },
          { table: "crawl_jobs", filter: `search_id=eq.${search.id}` },
          { table: "leads", filter: `source_search_id=eq.${search.id}`, event: "INSERT" },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-helper text-fg-muted">
            <Link href="/searches" className="hover:underline">Live Progress</Link>
          </p>
          <h1 className="text-title font-semibold text-fg">{search.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ProductChip product={search.product} />
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <span className="inline-flex items-center gap-1 text-helper text-fg-muted" title={live ? "Updates arrive as they happen" : "Not connected to live updates; refresh the page to update"}>
              {live ? <Wifi className="size-4" /> : <WifiOff className="size-4" />} {live ? "Live" : "Not live"}
            </span>
            <span className="text-helper text-fg-muted">
              {search.status === "scheduled" && search.scheduled_at ? `Starts ${formatPkDateTime(search.scheduled_at)}` : `Created ${formatPkDateTime(search.created_at)}`}
            </span>
          </div>
        </div>
        {canControl ? (
          <div className="flex flex-wrap gap-2">
            {active || search.status === "scheduled" ? (
              <Button onClick={() => run("pause", () => pauseSearch(search.id))} loading={busy === "pause"} disabled={!!busy}>
                <Pause /> Pause
              </Button>
            ) : null}
            {canResume ? (
              <Button variant="primary" onClick={() => run("resume", () => startSearch(search.id))} loading={busy === "resume"} disabled={!!busy}>
                {search.status === "draft" ? <Play /> : search.status === "failed" ? <RotateCcw /> : <Play />}
                {search.status === "draft" ? "Start" : search.status === "failed" ? "Retry failed cities" : "Resume"}
              </Button>
            ) : null}
            {!["done", "cancelled"].includes(search.status) ? (
              <Button variant="destructive" onClick={() => setConfirmCancel(true)} disabled={!!busy}>
                <Ban /> Cancel
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {search.error ? (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-body text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {search.error}
        </p>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {counters.map((c) => (
          <div key={c.label} className="rounded-card border border-border bg-surface p-4">
            <p className="text-helper text-fg-muted">{c.label}</p>
            <p className="tabular mt-1 text-section font-semibold text-fg">{c.value}</p>
          </div>
        ))}
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-helper text-fg-muted">Google calls and cost</p>
          <p className="tabular mt-1 text-section font-semibold text-fg">
            {formatNumber(search.actual_calls)} · {formatMoney(Number(search.actual_cost_pkr), "PKR")}
          </p>
          <p className="text-helper text-fg-muted">Estimate {formatNumber(search.estimated_calls)} · {formatMoney(Number(search.estimated_cost_pkr), "PKR")}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Cities" description={`${cities.length} cities and areas, ${search.keywords.length} keywords each`} />
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-body">
              <thead className="sticky top-0 bg-neutral-soft">
                <tr className="text-left text-helper text-fg-muted">
                  <th className="h-11 px-3 font-semibold">City</th>
                  <th className="px-3 font-semibold">Progress</th>
                  <th className="px-3 text-right font-semibold">Found</th>
                  <th className="px-3 text-right font-semibold">Saved</th>
                  <th className="px-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c) => {
                  const s = SEARCH_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
                  const done = ["done", "failed", "cancelled"].includes(c.status);
                  return (
                    <tr key={c.id} className="h-11 border-b border-border last:border-b-0">
                      <td className="px-3">
                        {c.city}
                        {c.area ? <span className="text-fg-muted">, {c.area}</span> : null}
                        {c.error ? <p className="text-helper text-error">{c.error}</p> : null}
                      </td>
                      <td className="w-40 px-3">
                        <ProgressBar value={done ? keywords : Math.min(keywords, c.keyword_index)} max={keywords} isLimit={false} label={`${c.city} progress`} />
                      </td>
                      <td className="tabular px-3 text-right">{formatNumber(c.found_count)}</td>
                      <td className="tabular px-3 text-right">{formatNumber(c.saved_count)}</td>
                      <td className="px-3"><StatusChip tone={s.tone}>{s.label}</StatusChip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Live feed" description="Newest businesses as they are saved" />
          <CardBody className="p-0">
            {feed.length === 0 ? (
              <p className="px-4 py-8 text-center text-body text-fg-muted">{active ? "Waiting for the first results…" : "No businesses saved by this search."}</p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
                {feed.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-brand-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-fg">{l.name}</p>
                        <p className="truncate text-helper text-fg-muted">
                          {[l.area, l.city].filter(Boolean).join(", ")}
                          {l.phone ? ` · ${l.phone}` : ""}
                          {l.website ? " · website" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-helper text-fg-muted">{formatPkDateTime(l.created_at).split(", ").pop()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Websites that could not be crawled" description="Websites that failed after three retries, or whose robots file does not allow crawling. Retry queues a website again." />
        {failures.length === 0 ? (
          <CardBody>
            <p className="text-body text-fg-muted">No failed crawls.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {failures.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{f.leadName ?? f.url}</p>
                  <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-helper text-brand-600 hover:underline">
                    {f.url} <ExternalLink className="size-3" />
                  </a>
                </div>
                <span className={cn("text-helper", f.status === "blocked_by_robots" ? "text-fg-muted" : "text-error")}>
                  {f.status === "blocked_by_robots" ? "Blocked by the site's robots file" : f.error_reason ?? "Failed"}
                </span>
                {canControl && f.status !== "blocked_by_robots" ? (
                  <Button size="sm" onClick={() => run(`retry-${f.id}`, () => retryCrawl(f.id))} loading={busy === `retry-${f.id}`} disabled={!!busy}>
                    <RotateCcw /> Retry
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this search?"
        description={`No more Google calls will be made for ${search.name}. The ${formatNumber(progress.saved ?? 0)} leads already saved are kept.`}
        confirmLabel="Cancel search"
        cancelLabel="Keep it"
        destructive
        onConfirm={async () => {
          setConfirmCancel(false);
          await run("cancel", () => cancelSearch(search.id));
        }}
      />
    </>
  );
}
