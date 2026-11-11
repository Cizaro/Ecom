import { z } from "zod";

const PLACEHOLDER_PREFIX = "CHANGE_ME";

const secret = z.string().min(32, "must be at least 32 characters");

/**
 * Variables required from Phase 1. Later phases add their own (payments, email, AI,
 * social); see .env.example for the full list.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL"),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "must be a Redis connection URL"),

  AUTH_SECRET: secret,
  ENCRYPTION_KEY: secret,

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

/** Secrets that must never keep their .env.example placeholder in production. */
const PRODUCTION_SECRETS = [
  "AUTH_SECRET",
  "ENCRYPTION_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const satisfies readonly (keyof Env)[];

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Report variable names and problems only, never the values.
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const env = result.data;
  if (env.NODE_ENV === "production") {
    const placeholders = PRODUCTION_SECRETS.filter((key) =>
      env[key].startsWith(PLACEHOLDER_PREFIX),
    );
    if (placeholders.length > 0) {
      throw new EnvValidationError(
        placeholders.map((key) => `${key}: still set to the example placeholder`),
      );
    }
  }
  return env;
}

let cached: Env | undefined;

/** Validated environment. Parsed once on first use; throws if configuration is invalid. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
