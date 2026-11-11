import { Redis } from "ioredis";
import { redisConnectionOptions } from "./redis";

export interface RateLimitRule {
  /** Number of hits allowed inside the window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitStatus {
  blocked: boolean;
  count: number;
  /** Seconds until the window ends; 0 when nothing has been counted. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter. `check` reads without counting, `hit` counts one
 * event, `reset` forgets a key. Used for sign-in lockout and similar limits:
 * check before the attempt, hit on failure.
 */
export interface RateLimiter {
  check(key: string, rule: RateLimitRule): Promise<RateLimitStatus>;
  hit(key: string, rule: RateLimitRule): Promise<RateLimitStatus>;
  reset(key: string): Promise<void>;
  close(): Promise<void>;
}

const status = (count: number, ttl: number, rule: RateLimitRule): RateLimitStatus => ({
  blocked: count >= rule.limit,
  count,
  retryAfterSeconds: count > 0 ? Math.max(ttl, 1) : 0,
});

export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const entries = new Map<string, { count: number; expiresAt: number }>();
  const read = (key: string) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };
  const ttl = (expiresAt: number) => Math.ceil((expiresAt - now()) / 1000);

  return {
    async check(key, rule) {
      const entry = read(key);
      return entry ? status(entry.count, ttl(entry.expiresAt), rule) : status(0, 0, rule);
    },
    async hit(key, rule) {
      const entry = read(key) ?? { count: 0, expiresAt: now() + rule.windowSeconds * 1000 };
      entry.count += 1;
      entries.set(key, entry);
      return status(entry.count, ttl(entry.expiresAt), rule);
    },
    async reset(key) {
      entries.delete(key);
    },
    async close() {
      entries.clear();
    },
  };
}

const PREFIX = "ratelimit:";

export function createRedisRateLimiter(redisUrl: string): RateLimiter {
  const redis = new Redis({
    ...redisConnectionOptions(redisUrl),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
  });
  // Errors surface through the awaited commands.
  redis.on("error", () => {});

  return {
    async check(key, rule) {
      const [count, ttl] = await Promise.all([redis.get(PREFIX + key), redis.ttl(PREFIX + key)]);
      return status(Number(count ?? 0), ttl, rule);
    },
    async hit(key, rule) {
      const results = await redis
        .multi()
        .incr(PREFIX + key)
        .expire(PREFIX + key, rule.windowSeconds, "NX")
        .ttl(PREFIX + key)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? rule.windowSeconds);
      return status(count, ttl, rule);
    },
    async reset(key) {
      await redis.del(PREFIX + key);
    },
    async close() {
      redis.disconnect();
    },
  };
}

/** Removes every rate-limit counter. For development and test setup only. */
export async function clearRedisRateLimits(redisUrl: string): Promise<number> {
  const redis = new Redis({ ...redisConnectionOptions(redisUrl), maxRetriesPerRequest: 1 });
  try {
    const keys = await redis.keys(`${PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
    return keys.length;
  } finally {
    redis.disconnect();
  }
}
