import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env";

const valid = {
  NODE_ENV: "development",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://app:pw@localhost:5432/ecommerce",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "a".repeat(32),
  ENCRYPTION_KEY: "b".repeat(32),
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "ecommerce-media",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_PUBLIC_URL: "http://localhost:9000/ecommerce-media",
};

describe("parseEnv", () => {
  it("accepts a complete configuration and applies defaults", () => {
    const env = parseEnv({ ...valid, NODE_ENV: undefined });
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("lists every missing or invalid variable by name", () => {
    const attempt = () =>
      parseEnv({ ...valid, DATABASE_URL: undefined, REDIS_URL: "http://nope", AUTH_SECRET: "x" });
    expect(attempt).toThrow(EnvValidationError);
    try {
      attempt();
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("DATABASE_URL");
      expect(issues).toContain("REDIS_URL");
      expect(issues).toContain("AUTH_SECRET");
    }
  });

  it("never includes secret values in the error message", () => {
    const leaked = "super-secret-value";
    try {
      parseEnv({ ...valid, AUTH_SECRET: leaked });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(leaked);
    }
  });

  it("allows example placeholders in development", () => {
    const placeholder = "CHANGE_ME_GENERATE_32_RANDOM_BYTES";
    expect(() => parseEnv({ ...valid, AUTH_SECRET: placeholder })).not.toThrow();
  });

  it("rejects example placeholders in production", () => {
    const placeholder = "CHANGE_ME_GENERATE_32_RANDOM_BYTES";
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: "production", ENCRYPTION_KEY: placeholder }),
    ).toThrow(/ENCRYPTION_KEY/);
  });
});
