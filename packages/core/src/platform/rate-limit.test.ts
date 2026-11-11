import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "./rate-limit";

const rule = { limit: 3, windowSeconds: 60 };

describe("memory rate limiter", () => {
  it("blocks once the limit is reached and reports when to retry", async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter(() => now);

    expect(await limiter.check("k", rule)).toEqual({
      blocked: false,
      count: 0,
      retryAfterSeconds: 0,
    });
    await limiter.hit("k", rule);
    await limiter.hit("k", rule);
    expect((await limiter.check("k", rule)).blocked).toBe(false);

    now += 20_000;
    const third = await limiter.hit("k", rule);
    expect(third).toEqual({ blocked: true, count: 3, retryAfterSeconds: 40 });
  });

  it("checking does not count as a hit", async () => {
    const limiter = createMemoryRateLimiter();
    for (let i = 0; i < 10; i += 1) await limiter.check("k", rule);
    expect((await limiter.check("k", rule)).count).toBe(0);
  });

  it("forgets after the window ends; the window is not extended by later hits", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    await limiter.hit("k", rule);
    now += 59_000;
    await limiter.hit("k", rule);
    await limiter.hit("k", rule);
    expect((await limiter.check("k", rule)).blocked).toBe(true);

    now += 1_000;
    expect(await limiter.check("k", rule)).toEqual({
      blocked: false,
      count: 0,
      retryAfterSeconds: 0,
    });
  });

  it("keeps keys separate and can reset one", async () => {
    const limiter = createMemoryRateLimiter();
    for (let i = 0; i < 3; i += 1) await limiter.hit("a", rule);
    expect((await limiter.check("a", rule)).blocked).toBe(true);
    expect((await limiter.check("b", rule)).blocked).toBe(false);

    await limiter.reset("a");
    expect((await limiter.check("a", rule)).blocked).toBe(false);
  });
});
