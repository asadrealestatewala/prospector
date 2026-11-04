import { Queue, type ConnectionOptions } from "bullmq";

/**
 * Background queues (SRS 8.3). Redis runs on the same server; REDIS_URL defaults to the local one.
 * Every job is safe to run twice: the worker claims its city row before doing any paid call.
 */
export const PLACES_QUEUE = "places-search";
export const MAINTENANCE_QUEUE = "maintenance";
export const CRAWL_QUEUE = "website-crawl";
export const VERIFY_QUEUE = "email-verify";

export type PlacesJob = { searchCityId: string };
export type CrawlJob = { crawlJobId: string };
export type VerifyJob = { contactId: string };

/** SRS 8.3: a website is tried once and retried three times, then marked failed. */
export const CRAWL_ATTEMPTS = 4;

export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const g = globalThis as unknown as { __placesQueue?: Queue<PlacesJob>; __crawlQueue?: Queue<CrawlJob>; __verifyQueue?: Queue<VerifyJob> };

export function placesQueue(): Queue<PlacesJob> {
  if (!g.__placesQueue) {
    g.__placesQueue = new Queue<PlacesJob>(PLACES_QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
  }
  return g.__placesQueue;
}

export function crawlQueue(): Queue<CrawlJob> {
  if (!g.__crawlQueue) {
    g.__crawlQueue = new Queue<CrawlJob>(CRAWL_QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: CRAWL_ATTEMPTS,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 20000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
  }
  return g.__crawlQueue;
}

/** One job per crawl row; the hand-over time keeps a retried crawl from colliding with its old job. */
export async function enqueueCrawls(rows: { id: string; enqueuedAt: string }[]) {
  if (rows.length === 0) return;
  await withTimeout(
    crawlQueue().addBulk(
      rows.map((r) => ({ name: "crawl", data: { crawlJobId: r.id }, opts: { jobId: `crawl-${r.id}-${new Date(r.enqueuedAt).getTime()}` } })),
    ),
  );
}

export function verifyQueue(): Queue<VerifyJob> {
  if (!g.__verifyQueue) {
    g.__verifyQueue = new Queue<VerifyJob>(VERIFY_QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 20000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
  }
  return g.__verifyQueue;
}

export async function enqueueVerifications(rows: { id: string; enqueuedAt: string }[]) {
  if (rows.length === 0) return;
  await withTimeout(
    verifyQueue().addBulk(
      rows.map((r) => ({ name: "verify", data: { contactId: r.id }, opts: { jobId: `verify-${r.id}-${new Date(r.enqueuedAt).getTime()}` } })),
    ),
  );
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  // Redis being down must not leave the screen waiting forever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError()), 8000);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** One job per city row. The attempt number keeps a resumed city from colliding with its old job. */
export async function enqueueCities(cityIds: string[], attempt: string) {
  if (cityIds.length === 0) return;
  await withTimeout(
    placesQueue().addBulk(cityIds.map((id) => ({ name: "city", data: { searchCityId: id }, opts: { jobId: `city-${id}-${attempt}` } }))),
  );
}

export class QueueUnavailableError extends Error {
  constructor() {
    super("The background queue (Redis) is not reachable. Check that Redis and the workers are running.");
    this.name = "QueueUnavailableError";
  }
}
