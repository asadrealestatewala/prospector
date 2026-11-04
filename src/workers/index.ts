/**
 * Prospector background workers (SRS 8.3), run under PM2 next to the web app:
 *   npm run workers        (development, reads .env.local)
 *   pm2 start ecosystem.config.cjs
 * Jobs live in Redis, so they survive a restart; PM2 restarts this process after a crash.
 */
import { createClient } from "@supabase/supabase-js";
import { Queue, Worker } from "bullmq";
import { decryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
import { CRAWL_QUEUE, enqueueCrawls, MAINTENANCE_QUEUE, PLACES_QUEUE, redisConnection, type CrawlJob, type PlacesJob } from "@/lib/engine/queue";
import { queueSearch } from "@/lib/engine/start-search";
import { crawlSite, loadRobots } from "@/workers/crawl-site";
import { processPlacesJob, startDueSearches } from "@/workers/places-search";
import { dispatchCrawls, processCrawlJob } from "@/workers/website-crawl";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in the worker environment (.env.local).`);
  return v;
}

const db = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encKey = parseEncryptionKey(required("SETTINGS_ENCRYPTION_KEY"));

async function googleKey(): Promise<string | null> {
  const { data } = await db.from("settings").select("secret_ciphertext").eq("key", "google.places_api_key").maybeSingle();
  return data?.secret_ciphertext ? decryptSecret(data.secret_ciphertext, encKey, "google.places_api_key") : null;
}

function log(msg: string, extra: Record<string, unknown> = {}) {
  // Never log keys or contact details; ids and counts only.
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
}

const connection = redisConnection();
const concurrency = Number(process.env.PLACES_CONCURRENCY || 3);
const crawlConcurrency = Number(process.env.CRAWL_CONCURRENCY || 5);

const places = new Worker<PlacesJob>(
  PLACES_QUEUE,
  (job) => processPlacesJob(job, { db, getApiKey: googleKey, pageDelayMs: 1500, log }),
  { connection, concurrency },
);
places.on("completed", (job, result) => log("places job done", { jobId: job.id, result }));
places.on("failed", (job, err) => log("places job failed", { jobId: job?.id, attempts: job?.attemptsMade, error: err.message }));

// Websites are crawled in parallel (SRS 9.2), CRAWL_CONCURRENCY at a time.
const crawls = new Worker<CrawlJob>(
  CRAWL_QUEUE,
  (job) => processCrawlJob(job, { db, crawl: crawlSite, robots: (url) => loadRobots(url), log }),
  { connection, concurrency: crawlConcurrency, lockDuration: 120_000 },
);
crawls.on("completed", (job, result) => log("crawl job done", { jobId: job.id, result }));
crawls.on("failed", (job, err) => log("crawl job failed", { jobId: job?.id, attempts: job?.attemptsMade, error: err.message }));

const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
void maintenance
  .upsertJobScheduler("start-scheduled-searches", { every: 60_000 }, { name: "start-scheduled-searches" })
  .catch((e: Error) => log("scheduler setup failed", { error: e.message }));
// New leads add crawl rows in the database; this hands them to the crawl queue every 15 seconds.
void maintenance
  .upsertJobScheduler("dispatch-crawls", { every: 15_000 }, { name: "dispatch-crawls" })
  .catch((e: Error) => log("scheduler setup failed", { error: e.message }));
const maintenanceWorker = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.name === "start-scheduled-searches") {
      const n = await startDueSearches(db, async (id) => {
        const r = await queueSearch(db, id);
        log("scheduled search", { searchId: id, ok: r.ok, message: r.ok ? null : r.message });
      });
      return `${n} started`;
    }
    if (job.name === "dispatch-crawls") {
      const n = await dispatchCrawls(db, enqueueCrawls);
      if (n) log("crawls queued", { count: n });
      return `${n} queued`;
    }
    return "unknown job";
  },
  { connection, concurrency: 1 },
);

maintenanceWorker.on("failed", (job, err) => log("maintenance job failed", { job: job?.name, error: err.message }));

log("workers started", { concurrency, crawlConcurrency });

async function shutdown() {
  log("workers stopping");
  await Promise.allSettled([places.close(), crawls.close(), maintenanceWorker.close(), maintenance.close()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
