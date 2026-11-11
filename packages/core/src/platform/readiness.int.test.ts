import { getEnv } from "@ecom/config";
import { afterAll, describe, expect, it } from "vitest";
import { checkReadiness, closeReadinessConnections } from "./readiness";

// Integration test: needs `docker compose up -d` and a .env file.
describe("checkReadiness (against local services)", () => {
  afterAll(closeReadinessConnections);

  it("reports every dependency reachable", async () => {
    const result = await checkReadiness(getEnv());
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports failures without throwing", async () => {
    const result = await checkReadiness({
      ...getEnv(),
      REDIS_URL: "redis://127.0.0.1:1",
      S3_BUCKET: "bucket-that-does-not-exist",
    });
    expect(result.ok).toBe(false);
    const byName = Object.fromEntries(result.checks.map((check) => [check.name, check.ok]));
    expect(byName).toEqual({ database: true, redis: false, storage: false });
  });
});
