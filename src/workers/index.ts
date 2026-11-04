/**
 * Prospector background workers (SRS 8.3), run under PM2 next to the web app:
 *   npm run workers        (development, reads .env.local)
 *   pm2 start ecosystem.config.cjs
 * Jobs live in Redis, so they survive a restart; PM2 restarts this process after a crash.
 */
import { createClient } from "@supabase/supabase-js";
import { Queue, Worker } from "bullmq";
import { decryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
import { resolveMx } from "node:dns/promises";
import { isProviderId } from "@/lib/engine/email-verify";
import {
  CRAWL_QUEUE, EMAIL_QUEUE, enqueueCampaignEmails, enqueueCrawls, enqueueVerifications, MAINTENANCE_QUEUE, PLACES_QUEUE,
  redisConnection, VERIFY_QUEUE, type CrawlJob, type EmailJob, type PlacesJob, type VerifyJob,
} from "@/lib/engine/queue";
import { queueSearch } from "@/lib/engine/start-search";
import { crawlSite, loadRobots } from "@/workers/crawl-site";
import { processPlacesJob, startDueSearches } from "@/workers/places-search";
import { dispatchCrawls, processCrawlJob } from "@/workers/website-crawl";
import { dispatchVerifications, processVerifyJob } from "@/workers/email-verify";
import { dispatchEmailCampaigns, processEmailJob } from "@/workers/email-send";

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

async function resendKey(): Promise<string | null> {
  const { data } = await db.from("settings").select("secret_ciphertext").eq("key", "resend.api_key").maybeSingle();
  return data?.secret_ciphertext ? decryptSecret(data.secret_ciphertext, encKey, "resend.api_key") : null;
}

async function verifyProvider() {
  const { data } = await db.from("settings").select("key, value, secret_ciphertext").in("key", ["email_verification.provider", "email_verification.api_key"]);
  const id = data?.find((r) => r.key === "email_verification.provider")?.value;
  const cipher = data?.find((r) => r.key === "email_verification.api_key")?.secret_ciphertext;
  if (!isProviderId(id) || !cipher) return null;
  return { id, apiKey: decryptSecret(cipher, encKey, "email_verification.api_key") };
}

/** Mail servers for a domain; a domain with none gives an empty list, a DNS outage throws. */
async function mailServers(domain: string): Promise<string[]> {
  try {
    return (await resolveMx(domain)).map((m) => m.exchange).filter(Boolean);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw e;
  }
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

const verifier = new Worker<VerifyJob>(
  VERIFY_QUEUE,
  (job) => processVerifyJob(job, { db, getProvider: verifyProvider, resolveMx: mailServers, log }),
  { connection, concurrency: Number(process.env.VERIFY_CONCURRENCY || 3) },
);
verifier.on("failed", (job, err) => log("verify job failed", { jobId: job?.id, attempts: job?.attemptsMade, error: err.message }));

// Emails go out one at a time per job; the limiter keeps under Resend's default of 2 requests a second.
const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
if (!appUrl) log("APP_URL is not set; email campaigns will pause until it is");
const emails = new Worker<EmailJob>(
  EMAIL_QUEUE,
  (job) => processEmailJob(job, { db, getApiKey: resendKey, encryptionKey: encKey, appUrl, log }),
  { connection, concurrency: 2, limiter: { max: 2, duration: 1000 } },
);
emails.on("failed", (job, err) => log("email job failed", { jobId: job?.id, attempts: job?.attemptsMade, error: err.message }));

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
      // The same 15-second tick also hands over requested email checks.
      // Each dispatcher runs even when another fails (for example a database hiccup on one table).
      const run = async (name: string, f: () => Promise<number>) => {
        try {
          return await f();
        } catch (err) {
          log("dispatch failed", { dispatcher: name, error: (err as Error).message });
          return 0;
        }
      };
      const n = await run("crawls", () => dispatchCrawls(db, enqueueCrawls));
      const v = await run("verifications", () => dispatchVerifications(db, enqueueVerifications));
      const e = await run("emails", () => dispatchEmailCampaigns(db, enqueueCampaignEmails));
      if (n || v || e) log("jobs queued", { crawls: n, verifications: v, emails: e });
      return `${n} crawls, ${v} checks, ${e} emails queued`;
    }
    return "unknown job";
  },
  { connection, concurrency: 1 },
);

maintenanceWorker.on("failed", (job, err) => log("maintenance job failed", { job: job?.name, error: err.message }));

log("workers started", { concurrency, crawlConcurrency });

async function shutdown() {
  log("workers stopping");
  await Promise.allSettled([places.close(), crawls.close(), verifier.close(), emails.close(), maintenanceWorker.close(), maintenance.close()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
