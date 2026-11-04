/**
 * Prospector background workers (SRS 8.3), run under PM2 next to the web app:
 *   npm run workers        (development, reads .env.local)
 *   pm2 start ecosystem.config.cjs
 * Jobs live in Redis, so they survive a restart; PM2 restarts this process after a crash.
 */
import { createClient } from "@supabase/supabase-js";
import { Queue, Worker } from "bullmq";
import { decryptSecret, parseEncryptionKey } from "@/lib/crypto/secrets";
import { MAINTENANCE_QUEUE, PLACES_QUEUE, redisConnection, type PlacesJob } from "@/lib/engine/queue";
import { queueSearch } from "@/lib/engine/start-search";
import { processPlacesJob, startDueSearches } from "@/workers/places-search";

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

const places = new Worker<PlacesJob>(
  PLACES_QUEUE,
  (job) => processPlacesJob(job, { db, getApiKey: googleKey, pageDelayMs: 1500, log }),
  { connection, concurrency },
);
places.on("completed", (job, result) => log("places job done", { jobId: job.id, result }));
places.on("failed", (job, err) => log("places job failed", { jobId: job?.id, attempts: job?.attemptsMade, error: err.message }));

const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
void maintenance
  .upsertJobScheduler("start-scheduled-searches", { every: 60_000 }, { name: "start-scheduled-searches" })
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
    return "unknown job";
  },
  { connection, concurrency: 1 },
);

log("workers started", { concurrency });

async function shutdown() {
  log("workers stopping");
  await Promise.allSettled([places.close(), maintenanceWorker.close(), maintenance.close()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
