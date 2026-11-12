import { getEnv } from "@ecom/config";
import {
  createLogger,
  createS3Storage,
  createTenantDb,
  closeQueues,
  enqueueMediaProcessing,
  listUnprocessedMedia,
  MAINTENANCE_JOBS,
  markMediaAssetFailed,
  MEDIA_JOBS,
  processMediaAsset,
  QUEUES,
  redisConnectionOptions,
  type MediaProcessingJob,
} from "@ecom/core";
import { disconnectDatabase, getAppPrisma } from "@ecom/db";
import { Queue, Worker } from "bullmq";

const env = getEnv();
const logger = createLogger("worker", env.LOG_LEVEL);

// BullMQ requires maxRetriesPerRequest to be null on worker connections.
const connection = { ...redisConnectionOptions(env.REDIS_URL), maxRetriesPerRequest: null };

const storage = createS3Storage(env);
const appPrisma = getAppPrisma(env.DATABASE_URL);
/** Tenant-bound database handle: Row-Level Security applies to the worker too. */
const tenantDb = (tenantId: string) => createTenantDb(appPrisma, { tenantId });

/** An upload is given this long to be queued normally before the sweep queues it. */
const SWEEP_AFTER_MS = 2 * 60_000;

const maintenanceQueue = new Queue(QUEUES.maintenance, { connection });

const maintenanceWorker = new Worker(
  QUEUES.maintenance,
  async (job) => {
    switch (job.name) {
      case MAINTENANCE_JOBS.heartbeat:
        logger.debug({ jobId: job.id }, "heartbeat");
        return { at: new Date().toISOString() };
      case MAINTENANCE_JOBS.mediaSweep: {
        const waiting = await listUnprocessedMedia(env.DATABASE_ADMIN_URL, SWEEP_AFTER_MS);
        for (const item of waiting) await enqueueMediaProcessing(env.REDIS_URL, item);
        if (waiting.length > 0) logger.info({ count: waiting.length }, "media sweep queued assets");
        return { queued: waiting.length };
      }
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  },
  { connection },
);

const mediaWorker = new Worker<MediaProcessingJob>(
  QUEUES.media,
  async (job) => {
    if (job.name !== MEDIA_JOBS.process) throw new Error(`Unknown media job: ${job.name}`);
    const { tenantId, assetId } = job.data;
    const outcome = await processMediaAsset(tenantDb(tenantId), storage, assetId);
    logger.info({ jobId: job.id, tenantId, assetId, outcome }, "media processed");
    return { outcome };
  },
  { connection, concurrency: 2 },
);

mediaWorker.on("failed", (job, error) => {
  logger.error(
    { jobId: job?.id, attempt: job?.attemptsMade, err: error.message },
    "media job failed",
  );
  // After the last attempt, record the failure so it is visible and not retried forever.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markMediaAssetFailed(tenantDb(job.data.tenantId), job.data.assetId, error.message).catch(
      (markError: Error) => logger.error({ err: markError.message }, "could not mark media failed"),
    );
  }
});

for (const worker of [maintenanceWorker, mediaWorker]) {
  worker.on("error", (error) => {
    logger.error({ err: error.message }, "worker error");
  });
}
maintenanceWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, err: error.message }, "job failed");
});

// A repeatable job proves the queue, scheduler and consumer are wired together.
await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.heartbeat,
  { every: 60_000 },
  { name: MAINTENANCE_JOBS.heartbeat, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);
await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.mediaSweep,
  { every: 60_000 },
  { name: MAINTENANCE_JOBS.mediaSweep, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

logger.info({ queues: Object.values(QUEUES) }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker shutting down");
  await Promise.all([maintenanceWorker.close(), mediaWorker.close()]);
  await maintenanceQueue.close();
  await closeQueues();
  await disconnectDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
