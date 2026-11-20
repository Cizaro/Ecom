import { Redis } from "ioredis";
import { redisConnectionOptions } from "./redis";

// The background worker's "still alive" mark (launch hardening, D118). The
// worker writes the time every minute; the admin warns owners and managers
// when it is older than STALE_AFTER_MS, because nothing else shows that
// automatic replies, emails, the Instagram check and scheduled posts stopped.

const KEY = "worker:heartbeat";
/** The mark expires by itself if the worker stops writing it. */
const TTL_SECONDS = 60 * 60;
export const WORKER_STALE_AFTER_MS = 3 * 60_000;

function connect(redisUrl: string): Redis {
  const redis = new Redis({
    ...redisConnectionOptions(redisUrl),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
  });
  // Errors surface through the awaited commands.
  redis.on("error", () => {});
  return redis;
}

/** For the worker: records that it is alive now. */
export async function recordWorkerHeartbeat(
  redisUrl: string,
  now = new Date(),
  /** Tests use their own key, so they never touch the real mark. */
  key = KEY,
): Promise<void> {
  const redis = connect(redisUrl);
  try {
    await redis.set(key, now.toISOString(), "EX", TTL_SECONDS);
  } finally {
    redis.disconnect();
  }
}

export type WorkerStatus =
  | { state: "running"; lastSeen: Date }
  | { state: "stopped"; lastSeen: Date | null }
  /** Redis could not be asked; nothing is claimed either way. */
  | { state: "unknown"; lastSeen: null };

/** When the worker was last seen, and whether that counts as running. */
export async function workerStatus(
  redisUrl: string,
  now = new Date(),
  key = KEY,
): Promise<WorkerStatus> {
  const redis = connect(redisUrl);
  try {
    const value = await redis.get(key);
    const lastSeen = value ? new Date(value) : null;
    if (!lastSeen || Number.isNaN(lastSeen.getTime())) return { state: "stopped", lastSeen: null };
    return now.getTime() - lastSeen.getTime() <= WORKER_STALE_AFTER_MS
      ? { state: "running", lastSeen }
      : { state: "stopped", lastSeen };
  } catch {
    return { state: "unknown", lastSeen: null };
  } finally {
    redis.disconnect();
  }
}
