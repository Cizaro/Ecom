import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Env } from "@ecom/config";
import { disconnectDatabase, pingDatabase } from "@ecom/db";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "./redis";

export interface ReadinessCheck {
  name: "database" | "redis" | "storage";
  ok: boolean;
  latencyMs: number;
  /** Internal detail for logs and the developer health check. Never send to clients. */
  error?: string;
}

export interface ReadinessResult {
  ok: boolean;
  checks: ReadinessCheck[];
}

type ReadinessEnv = Pick<
  Env,
  | "DATABASE_URL"
  | "REDIS_URL"
  | "S3_ENDPOINT"
  | "S3_REGION"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
>;

const CHECK_TIMEOUT_MS = 4_000;

async function timed(
  name: ReadinessCheck["name"],
  probe: () => Promise<void>,
): Promise<ReadinessCheck> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { name, ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message || error.name : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pingRedis(redisUrl: string): Promise<void> {
  const redis = new Redis({
    ...redisConnectionOptions(redisUrl),
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Connection failures surface through the awaited calls below.
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

async function pingStorage(env: ReadinessEnv): Promise<void> {
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } finally {
    s3.destroy();
  }
}

/** Checks that the database, Redis and object storage are reachable. */
export async function checkReadiness(env: ReadinessEnv): Promise<ReadinessResult> {
  const checks = await Promise.all([
    timed("database", () => pingDatabase(env.DATABASE_URL)),
    timed("redis", () => pingRedis(env.REDIS_URL)),
    timed("storage", () => pingStorage(env)),
  ]);
  return { ok: checks.every((check) => check.ok), checks };
}

/** Releases pooled connections so short-lived scripts and tests can exit. */
export async function closeReadinessConnections(): Promise<void> {
  await disconnectDatabase();
}
