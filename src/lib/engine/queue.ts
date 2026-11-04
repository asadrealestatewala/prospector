import { Queue, type ConnectionOptions } from "bullmq";

/**
 * Background queues (SRS 8.3). Redis runs on the same server; REDIS_URL defaults to the local one.
 * Every job is safe to run twice: the worker claims its city row before doing any paid call.
 */
export const PLACES_QUEUE = "places-search";
export const MAINTENANCE_QUEUE = "maintenance";

export type PlacesJob = { searchCityId: string };

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

const g = globalThis as unknown as { __placesQueue?: Queue<PlacesJob> };

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

/** One job per city row. The attempt number keeps a resumed city from colliding with its old job. */
export async function enqueueCities(cityIds: string[], attempt: string) {
  if (cityIds.length === 0) return;
  const add = placesQueue().addBulk(
    cityIds.map((id) => ({ name: "city", data: { searchCityId: id }, opts: { jobId: `city-${id}-${attempt}` } })),
  );
  // Redis being down must not leave the screen waiting forever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError()), 8000);
  });
  try {
    await Promise.race([add, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class QueueUnavailableError extends Error {
  constructor() {
    super("The background queue (Redis) is not reachable. Check that Redis and the workers are running.");
    this.name = "QueueUnavailableError";
  }
}
