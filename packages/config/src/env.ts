import { z } from "zod";

const PLACEHOLDER_PREFIX = "CHANGE_ME";

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL");

/** Treats an empty value (`SMTP_USER=`) as not set. */
const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const secret = z.string().min(32, "must be at least 32 characters");

/**
 * Variables required from Phase 1. Later phases add their own (payments, email, AI,
 * social); see .env.example for the full list.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /** Runtime connection (role app_user, subject to Row-Level Security). */
  DATABASE_URL: postgresUrl,
  /** Owner connection: migrations, seeding, authentication, platform administration. */
  DATABASE_ADMIN_URL: postgresUrl,
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "must be a Redis connection URL"),

  AUTH_SECRET: secret,
  ENCRYPTION_KEY: secret,

  /**
   * Whether search engines may index the storefront. Off unless set to
   * "true", so development, test and staging copies stay out of search
   * results. Switch it on for the live site only.
   */
  ALLOW_SEARCH_INDEXING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_URL: z.url(),

  /** `console` only records that an email would be sent; `smtp` delivers it. */
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().min(3).default("store@example.com"),
  SMTP_HOST: optionalText,
  SMTP_PORT: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().int().min(1).max(65535).optional(),
  ),
  SMTP_USER: optionalText,
  SMTP_PASSWORD: optionalText,
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
  if (env.EMAIL_PROVIDER === "smtp" && (!env.SMTP_HOST || !env.SMTP_PORT)) {
    throw new EnvValidationError(["SMTP_HOST and SMTP_PORT: required when EMAIL_PROVIDER is smtp"]);
  }
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
