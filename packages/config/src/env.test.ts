import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env";

const valid = {
  NODE_ENV: "development",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://app_user:pw@localhost:5432/ecommerce",
  DATABASE_ADMIN_URL: "postgresql://app:pw@localhost:5432/ecommerce",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "a".repeat(32),
  ENCRYPTION_KEY: "b".repeat(32),
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "ecommerce-media",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_PUBLIC_URL: "http://localhost:9000/ecommerce-media",
  MOCK_PAYMENT_WEBHOOK_SECRET: "m".repeat(32),
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

  it("requires SMTP settings only when the smtp provider is selected", () => {
    expect(parseEnv({ ...valid, SMTP_HOST: "", SMTP_PORT: "" }).EMAIL_PROVIDER).toBe("console");
    expect(() => parseEnv({ ...valid, EMAIL_PROVIDER: "smtp" })).toThrow(/SMTP_HOST/);
    const env = parseEnv({
      ...valid,
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      SMTP_USER: "",
    });
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.SMTP_USER).toBeUndefined();
  });

  it("allows example placeholders in development", () => {
    const placeholder = "CHANGE_ME_GENERATE_32_RANDOM_BYTES";
    expect(() => parseEnv({ ...valid, AUTH_SECRET: placeholder })).not.toThrow();
  });

  it("rejects example placeholders in production", () => {
    const placeholder = "CHANGE_ME_GENERATE_32_RANDOM_BYTES";
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: "production",
        // Past the mock-payments check, so this test reaches the placeholder check.
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: "true",
        ENCRYPTION_KEY: placeholder,
      }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it("needs a signing secret for the mock payment provider", () => {
    expect(() => parseEnv({ ...valid, MOCK_PAYMENT_WEBHOOK_SECRET: undefined })).toThrow(
      /MOCK_PAYMENT_WEBHOOK_SECRET/,
    );
    expect(() => parseEnv({ ...valid, MOCK_PAYMENT_WEBHOOK_SECRET: "short" })).toThrow(
      EnvValidationError,
    );
  });

  it("refuses the mock payment provider in production unless explicitly allowed", () => {
    const production = { ...valid, NODE_ENV: "production" };
    expect(() => parseEnv(production)).toThrow(/mock provider takes no money/);
    expect(
      parseEnv({ ...production, ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: "true" }).PAYMENT_PROVIDER,
    ).toBe("mock");
    expect(() => parseEnv({ ...valid, PAYMENT_PROVIDER: "free-money" })).toThrow(
      EnvValidationError,
    );
  });

  it("runs without online payments (cash on delivery only), in production too", () => {
    const env = parseEnv({
      ...valid,
      NODE_ENV: "production",
      PAYMENT_PROVIDER: "none",
      MOCK_PAYMENT_WEBHOOK_SECRET: undefined,
    });
    expect(env.PAYMENT_PROVIDER).toBe("none");
  });
});

describe("AI provider settings", () => {
  it("defaults to the built-in stand-in", () => {
    expect(parseEnv(valid).AI_PROVIDER).toBe("mock");
  });

  it("needs each chosen provider's key and model, the backup's too", () => {
    expect(() => parseEnv({ ...valid, AI_PROVIDER: "groq" })).toThrow(
      /GROQ_API_KEY.*\n.*GROQ_MODEL/,
    );
    expect(() =>
      parseEnv({
        ...valid,
        AI_PROVIDER: "groq",
        GROQ_API_KEY: "g",
        GROQ_MODEL: "some-model",
        AI_FALLBACK_PROVIDER: "moonshot",
      }),
    ).toThrow(/MOONSHOT_API_KEY/);
    const env = parseEnv({
      ...valid,
      AI_PROVIDER: "groq",
      GROQ_API_KEY: "g",
      GROQ_MODEL: "some-model",
      AI_FALLBACK_PROVIDER: "moonshot",
      MOONSHOT_API_KEY: "m",
      MOONSHOT_MODEL: "kimi-model",
      AI_INPUT_PRICE_PER_MTOK: "0",
      AI_OUTPUT_PRICE_PER_MTOK: "0",
    });
    expect(env).toMatchObject({ AI_FALLBACK_PROVIDER: "moonshot", AI_INPUT_PRICE_PER_MTOK: 0 });
  });

  it("checks the other settings", () => {
    expect(() => parseEnv({ ...valid, AI_PROVIDER: "anthropic" })).toThrow(/AI_API_KEY/);
    expect(() =>
      parseEnv({
        ...valid,
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://ai.example.test/v1",
        AI_API_KEY: "k",
        AI_DEFAULT_MODEL: "m",
      }),
    ).toThrow(/https/);
    expect(
      parseEnv({
        ...valid,
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://localhost:11434/v1",
        AI_API_KEY: "k",
        AI_DEFAULT_MODEL: "m",
      }).AI_BASE_URL,
    ).toBe("http://localhost:11434/v1");
    expect(() => parseEnv({ ...valid, AI_FALLBACK_PROVIDER: "mock" })).toThrow();
    expect(() => parseEnv({ ...valid, AI_INPUT_PRICE_PER_MTOK: "1" })).toThrow(/both or neither/);
  });

  it("takes the Meta app's three settings together or not at all", () => {
    const meta = {
      META_APP_ID: "1414532210811508",
      META_APP_SECRET: "0123456789abcdef0123456789abcdef",
      META_WEBHOOK_VERIFY_TOKEN: "a-long-verify-phrase",
    };
    const env = parseEnv({ ...valid, ...meta });
    expect(env.META_GRAPH_VERSION).toBe("v23.0");
    expect(env.META_GRAPH_MODE).toBe("live");
    expect(() => parseEnv({ ...valid, META_APP_ID: meta.META_APP_ID })).toThrow(
      /all three or none/,
    );
    expect(() => parseEnv({ ...valid, ...meta, META_APP_SECRET: "short" })).toThrow(
      /META_APP_SECRET/,
    );
    expect(() => parseEnv({ ...valid, ...meta, META_GRAPH_VERSION: "23" })).toThrow(
      /META_GRAPH_VERSION/,
    );
    expect(parseEnv({ ...valid, META_APP_ID: "" }).META_APP_ID).toBeUndefined();
  });
});
