import { z } from "zod";

const PLACEHOLDER_PREFIX = "CHANGE_ME";

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection URL");

/** Treats an empty value (`SMTP_USER=`) as not set. */
const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const secret = z.string().min(32, "must be at least 32 characters");

/** The AI services the platform can use (see AI_PROVIDER below). */
export const AI_PROVIDERS = ["mock", "anthropic", "groq", "moonshot", "openai-compatible"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

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

  /**
   * Who takes online payments: "mock" (test page, no money) or "none" (no
   * online payment; cash on delivery only). A real card gateway is added
   * when the store has a merchant account.
   */
  PAYMENT_PROVIDER: z.enum(["mock", "none"]).default("mock"),
  /** Signs the mock provider's notifications to the webhook. */
  MOCK_PAYMENT_WEBHOOK_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    secret.optional(),
  ),
  /**
   * The mock provider lets anyone "pay" without money. It is refused in
   * production unless this is "true", which only the automated tests set.
   */
  ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  /**
   * Product import downloads picture links only from public internet
   * addresses. "true" also allows private ones (a local test server); only
   * the automated tests set it. Never set it on a live site.
   */
  IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS: z
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

  /**
   * Who answers AI tasks:
   * - "mock": a built-in stand-in that never calls an outside service (development and tests);
   * - "anthropic": Claude (AI_API_KEY, AI_DEFAULT_MODEL);
   * - "groq": Groq (GROQ_API_KEY, GROQ_MODEL);
   * - "moonshot": Moonshot / Kimi (MOONSHOT_API_KEY, MOONSHOT_MODEL);
   * - "openai-compatible": any other service in that format (AI_BASE_URL, AI_API_KEY, AI_DEFAULT_MODEL).
   */
  AI_PROVIDER: z.enum(AI_PROVIDERS).default("mock"),
  /** Takes over when the main provider is busy, unreachable or out of credit. */
  AI_FALLBACK_PROVIDER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(AI_PROVIDERS).exclude(["mock"]).optional(),
  ),
  AI_API_KEY: optionalText,
  GROQ_API_KEY: optionalText,
  GROQ_MODEL: optionalText,
  MOONSHOT_API_KEY: optionalText,
  MOONSHOT_MODEL: optionalText,
  /** The service's address for "openai-compatible", e.g. https://api.groq.com/openai/v1. */
  AI_BASE_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url().optional()),
  /**
   * What the model costs in dollars per million tokens, for the monthly
   * budget. Needed for models the built-in price list does not know; without
   * them such a model is counted at the most expensive known price. A free
   * test plan is 0 and 0.
   */
  AI_INPUT_PRICE_PER_MTOK: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().min(0).max(1000).optional(),
  ),
  AI_OUTPUT_PRICE_PER_MTOK: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().min(0).max(1000).optional(),
  ),
  AI_DEFAULT_MODEL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).default("claude-opus-5-5"),
  ),
  /** The most one store may spend on AI in a calendar month, in US dollars. */
  AI_MONTHLY_BUDGET_USD: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().min(0).max(100_000).default(50),
  ),
  /** Emergency switch: "true" stops every AI task for every store at once. */
  AI_PAUSED: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  ),
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
  const aiIssues = [env.AI_PROVIDER, env.AI_FALLBACK_PROVIDER]
    .filter((name): name is AiProviderName => name !== undefined)
    .flatMap((name) => aiProviderIssues(name, env, source));
  if (env.AI_FALLBACK_PROVIDER && env.AI_FALLBACK_PROVIDER === env.AI_PROVIDER) {
    aiIssues.push("AI_FALLBACK_PROVIDER: choose a different provider from AI_PROVIDER");
  }
  if (
    (env.AI_INPUT_PRICE_PER_MTOK === undefined) !==
    (env.AI_OUTPUT_PRICE_PER_MTOK === undefined)
  ) {
    aiIssues.push("AI_INPUT_PRICE_PER_MTOK and AI_OUTPUT_PRICE_PER_MTOK: set both or neither");
  }
  if (aiIssues.length > 0) throw new EnvValidationError([...new Set(aiIssues)]);
  if (env.EMAIL_PROVIDER === "smtp" && (!env.SMTP_HOST || !env.SMTP_PORT)) {
    throw new EnvValidationError(["SMTP_HOST and SMTP_PORT: required when EMAIL_PROVIDER is smtp"]);
  }
  if (env.PAYMENT_PROVIDER === "mock" && !env.MOCK_PAYMENT_WEBHOOK_SECRET) {
    throw new EnvValidationError([
      "MOCK_PAYMENT_WEBHOOK_SECRET: required when PAYMENT_PROVIDER is mock",
    ]);
  }
  if (
    env.NODE_ENV === "production" &&
    env.PAYMENT_PROVIDER === "mock" &&
    !env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION
  ) {
    throw new EnvValidationError([
      "PAYMENT_PROVIDER: the mock provider takes no money and cannot run in production",
    ]);
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

/** What a provider needs from the settings; empty when all is there. */
function aiProviderIssues(
  name: AiProviderName,
  env: Env,
  source: Record<string, string | undefined>,
): string[] {
  switch (name) {
    case "mock":
      return [];
    case "anthropic":
      return env.AI_API_KEY ? [] : ["AI_API_KEY: required for the anthropic provider"];
    case "groq":
      return [
        ...(env.GROQ_API_KEY ? [] : ["GROQ_API_KEY: required for the groq provider"]),
        ...(env.GROQ_MODEL ? [] : ["GROQ_MODEL: name the model (pnpm ai:models lists them)"]),
      ];
    case "moonshot":
      return [
        ...(env.MOONSHOT_API_KEY ? [] : ["MOONSHOT_API_KEY: required for the moonshot provider"]),
        ...(env.MOONSHOT_MODEL
          ? []
          : ["MOONSHOT_MODEL: name the model (pnpm ai:models lists them)"]),
      ];
    case "openai-compatible": {
      const issues: string[] = [];
      if (!env.AI_BASE_URL) issues.push("AI_BASE_URL: required for the openai-compatible provider");
      else if (
        !env.AI_BASE_URL.startsWith("https://") &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(env.AI_BASE_URL)
      ) {
        issues.push(
          "AI_BASE_URL: must start with https:// (http:// only for a model on this computer)",
        );
      }
      if (!env.AI_API_KEY) issues.push("AI_API_KEY: required for the openai-compatible provider");
      if (!source.AI_DEFAULT_MODEL)
        issues.push("AI_DEFAULT_MODEL: name the model (pnpm ai:models lists them)");
      return issues;
    }
  }
}
