/**
 * website-crawl worker (SRS 8.3): crawls one business website and saves the contact details it finds.
 * Safe to run twice: the job claims its crawl row first, and saving checks the job still holds it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { UnrecoverableError } from "bullmq";
import { isSocialOrLinkPage, productHints, socialLink, type Found, type SocialLink } from "@/lib/engine/crawl-extract";
import { CRAWL_ATTEMPTS, type CrawlJob } from "@/lib/engine/queue";
import type { CrawlSiteOptions, CrawlSiteResult, Robots } from "./crawl-site";

export type CrawlJobLike = { id?: string; data: CrawlJob; attemptsMade: number; opts?: { attempts?: number } };
export type CrawlDeps = {
  db: SupabaseClient;
  crawl: (url: string, opts: CrawlSiteOptions) => Promise<CrawlSiteResult>;
  robots: (url: string) => Promise<Robots | null>;
  maxPages?: number;
  timeoutSecs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export const ROBOTS_BLOCKED = "The website's robots file does not allow crawling.";

export async function processCrawlJob(job: CrawlJobLike, deps: CrawlDeps): Promise<string> {
  const { db } = deps;
  const jobId = String(job.id);
  const { data: claimed } = await db
    .from("crawl_jobs")
    .update({ status: "running", job_id: jobId, started_at: new Date().toISOString() })
    .eq("id", job.data.crawlJobId)
    .or(`status.eq.queued,and(status.eq.running,job_id.eq.${jobId})`)
    .select("id, lead_id, url")
    .maybeSingle();
  if (!claimed) return "skipped: crawl not queued";

  const { data: lead } = await db.from("leads").select("id, product").eq("id", claimed.lead_id).maybeSingle();
  if (!lead) return "skipped: lead deleted";

  let url: string;
  try {
    url = normaliseUrl(claimed.url);
  } catch {
    await finish(db, claimed.id, "failed", "The website address is not valid.");
    return "failed: bad url";
  }

  // A Facebook page or link page given as the website is kept as a social link; those sites are not crawled.
  if (isSocialOrLinkPage(url)) {
    const s = socialLink(url);
    await save(db, claimed.id, jobId, {
      pages: [],
      social: s ? [{ ...s, source_url: url }] : [],
      note: "The website is a social media or link page, so it was saved as a social link and not crawled.",
    });
    return "done: social page";
  }

  const robots = await deps.robots(url);
  if (robots && !robots.isAllowed(url)) {
    await finish(db, claimed.id, "blocked_by_robots", ROBOTS_BLOCKED);
    return "blocked by robots";
  }

  const r = await deps.crawl(url, { maxPages: deps.maxPages ?? 6, timeoutSecs: deps.timeoutSecs ?? 20, robots });

  if (r.pages.length === 0) {
    const reason = r.homepageError ?? "The website did not return a page.";
    const attempts = job.opts?.attempts ?? CRAWL_ATTEMPTS;
    const last = job.attemptsMade + 1 >= attempts || /private network/.test(reason);
    await db
      .from("crawl_jobs")
      .update({
        error_reason: reason,
        retries: job.attemptsMade,
        ...(last ? { status: "failed", finished_at: new Date().toISOString() } : {}),
      })
      .eq("id", claimed.id)
      .eq("job_id", jobId);
    if (last) throw new UnrecoverableError(reason);
    throw new Error(reason); // BullMQ tries again after a pause
  }

  const pick = (get: (p: CrawlSiteResult["pages"][number]) => Found[]) => {
    const m = new Map<string, Found>();
    for (const p of r.pages) for (const f of get(p)) if (!m.has(f.value)) m.set(f.value, f);
    return [...m.values()];
  };
  const social = new Map<string, SocialLink>();
  for (const p of r.pages) for (const s of p.social) if (!social.has(s.url)) social.set(s.url, s);
  const whatsapp = pick((p) => p.whatsapp);
  const phones = pick((p) => p.phones).filter((f) => !whatsapp.some((w) => w.value === f.value));
  const notes: string[] = [];
  if (r.skippedByRobots.length) notes.push(`${r.skippedByRobots.length} page(s) skipped because of the robots file.`);
  if (r.failures.length) notes.push(`${r.failures.length} page(s) could not be opened.`);

  const payload = {
    pages: r.pages.map((p) => ({ url: p.url, title: p.title })),
    emails: pick((p) => p.emails),
    phones,
    whatsapp,
    social: [...social.values()],
    description: r.pages[0].description,
    hints: productHints(lead.product, r.pages.map((p) => `${p.title ?? ""} ${p.description ?? ""} ${p.text}`).join(" "), [...social.values()]),
    note: notes.join(" ") || null,
  };
  const saved = await save(db, claimed.id, jobId, payload);
  deps.log?.("crawl saved", { crawlJobId: claimed.id, pages: payload.pages.length, ...(saved ?? {}) });
  return saved ? `done: ${payload.pages.length} pages` : "skipped: taken over";
}

function normaliseUrl(raw: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`;
  const u = new URL(withScheme);
  if (!/^https?:$/.test(u.protocol)) throw new Error("not http");
  u.hash = "";
  return u.toString();
}

async function save(db: SupabaseClient, crawlId: string, jobId: string, p: Record<string, unknown>) {
  const { data, error } = await db.rpc("save_crawl_result", { p_crawl_id: crawlId, p_job_id: jobId, p });
  if (error) throw new Error(`Could not save the crawl: ${error.message}`);
  return data as Record<string, number> | null;
}

async function finish(db: SupabaseClient, id: string, status: "failed" | "blocked_by_robots", reason: string) {
  await db.from("crawl_jobs").update({ status, error_reason: reason, finished_at: new Date().toISOString() }).eq("id", id);
}

/**
 * Hands queued crawl rows to Redis. Runs every few seconds from the maintenance queue.
 * If Redis refuses them, they are released so the next run tries again.
 */
export async function dispatchCrawls(db: SupabaseClient, enqueue: (rows: { id: string; enqueuedAt: string }[]) => Promise<void>) {
  const { data, error } = await db.rpc("take_crawls_to_enqueue", { p_limit: 500 });
  if (error) throw new Error(`Could not read queued crawls: ${error.message}`);
  const rows = ((data ?? []) as { id: string; enqueued_at: string }[]).map((r) => ({ id: r.id, enqueuedAt: r.enqueued_at }));
  if (rows.length === 0) return 0;
  try {
    await enqueue(rows);
  } catch (e) {
    await db.from("crawl_jobs").update({ enqueued_at: null }).in("id", rows.map((r) => r.id)).eq("status", "queued");
    throw e;
  }
  return rows.length;
}
