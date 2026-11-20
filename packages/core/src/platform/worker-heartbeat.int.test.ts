import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { describe, expect, it } from "vitest";
import { recordWorkerHeartbeat, WORKER_STALE_AFTER_MS, workerStatus } from "./worker-heartbeat";

// The worker's "still alive" mark in the real (test) Redis, under a key of
// this test's own.

const env = getEnv();
const key = `test:worker:heartbeat:${randomUUID()}`;

describe("worker heartbeat", () => {
  it("reads running while fresh, stopped when old or missing", async () => {
    expect(await workerStatus(env.REDIS_URL, new Date(), key)).toEqual({
      state: "stopped",
      lastSeen: null,
    });
    const at = new Date("2026-11-20T10:00:00.000Z");
    await recordWorkerHeartbeat(env.REDIS_URL, at, key);
    expect(await workerStatus(env.REDIS_URL, new Date(at.getTime() + 60_000), key)).toEqual({
      state: "running",
      lastSeen: at,
    });
    expect(
      await workerStatus(env.REDIS_URL, new Date(at.getTime() + WORKER_STALE_AFTER_MS + 1), key),
    ).toEqual({ state: "stopped", lastSeen: at });
  });

  it("claims nothing when Redis cannot be reached", async () => {
    expect(await workerStatus("redis://127.0.0.1:1", new Date(), key)).toEqual({
      state: "unknown",
      lastSeen: null,
    });
  });
});
