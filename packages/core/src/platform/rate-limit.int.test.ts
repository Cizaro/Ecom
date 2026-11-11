import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { afterAll, describe, expect, it } from "vitest";
import { createRedisRateLimiter } from "./rate-limit";

// Against the real Redis from docker compose: the implementation production uses.
const limiter = createRedisRateLimiter(getEnv().REDIS_URL);
const rule = { limit: 2, windowSeconds: 30 };

afterAll(() => limiter.close());

describe("redis rate limiter", () => {
  it("counts hits, blocks at the limit and resets", async () => {
    const key = `test:${randomUUID()}`;

    expect(await limiter.check(key, rule)).toEqual({
      blocked: false,
      count: 0,
      retryAfterSeconds: 0,
    });
    expect((await limiter.hit(key, rule)).blocked).toBe(false);

    const second = await limiter.hit(key, rule);
    expect(second.blocked).toBe(true);
    expect(second.count).toBe(2);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect((await limiter.check(key, rule)).blocked).toBe(true);

    await limiter.reset(key);
    expect((await limiter.check(key, rule)).count).toBe(0);
  });
});
