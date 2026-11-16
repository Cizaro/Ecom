import { getEnv } from "@ecom/config";
import {
  createEmailProvider,
  createLogger,
  createS3Storage,
  createTenantDb,
  closeQueues,
  deliverPendingEmails,
  enqueueMediaProcessing,
  expireUnpaidOrders,
  listTenantsWithExpiredOrders,
  listTenantsWithExpiredReservations,
  listTenantsWithPendingEmails,
  listTenantsWithPendingImportImages,
  processImportImages,
  listUnprocessedMedia,
  MAINTENANCE_JOBS,
  markMediaAssetFailed,
  MEDIA_JOBS,
  processMediaAsset,
  QUEUES,
  redisConnectionOptions,
  releaseExpiredReservations,
  type MediaProcessingJob,
} from "@ecom/core";
import { disconnectDatabase, getAppPrisma } from "@ecom/db";
import { Queue, Worker } from "bullmq";

const env = getEnv();
const logger = createLogger("worker", env.LOG_LEVEL);

// BullMQ requires maxRetriesPerRequest to be null on worker connections.
const connection = { ...redisConnectionOptions(env.REDIS_URL), maxRetriesPerRequest: null };

const storage = createS3Storage(env);
const email = createEmailProvider(env, logger);
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
      case MAINTENANCE_JOBS.stockSweep: {
        const tenants = await listTenantsWithExpiredReservations(env.DATABASE_ADMIN_URL);
        let released = 0;
        for (const tenantId of tenants) {
          released += await releaseExpiredReservations(tenantDb(tenantId));
        }
        if (released > 0) logger.info({ released }, "stock sweep released expired holds");
        return { released };
      }
      case MAINTENANCE_JOBS.orderSweep: {
        const tenants = await listTenantsWithExpiredOrders(env.DATABASE_ADMIN_URL);
        let cancelled = 0;
        for (const tenantId of tenants) cancelled += await expireUnpaidOrders(tenantDb(tenantId));
        if (cancelled > 0) logger.info({ cancelled }, "order sweep cancelled unpaid orders");
        return { cancelled };
      }
      case MAINTENANCE_JOBS.emailSweep: {
        const tenants = await listTenantsWithPendingEmails(env.DATABASE_ADMIN_URL);
        let sent = 0;
        let failed = 0;
        for (const tenantId of tenants) {
          const result = await deliverPendingEmails(tenantDb(tenantId), email, {
            appUrl: env.APP_URL,
            accessSecret: env.ENCRYPTION_KEY,
            limit: 50,
          });
          sent += result.sent;
          failed += result.failed;
        }
        if (sent > 0 || failed > 0) logger.info({ sent, failed }, "email sweep");
        return { sent, failed };
      }
      case MAINTENANCE_JOBS.importImagesSweep: {
        const tenants = await listTenantsWithPendingImportImages(env.DATABASE_ADMIN_URL);
        let done = 0;
        let failed = 0;
        for (const tenantId of tenants) {
          const result = await processImportImages(
            tenantDb(tenantId),
            { storage, enqueueProcessing: (item) => enqueueMediaProcessing(env.REDIS_URL, item) },
            { limit: 20, allowPrivateHosts: env.IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS },
          );
          done += result.done;
          failed += result.failed;
        }
        if (done > 0 || failed > 0) logger.info({ done, failed }, "import pictures sweep");
        return { done, failed };
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

await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.stockSweep,
  { every: 60_000 },
  { name: MAINTENANCE_JOBS.stockSweep, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.orderSweep,
  { every: 60_000 },
  { name: MAINTENANCE_JOBS.orderSweep, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.importImagesSweep,
  { every: 30_000 },
  { name: MAINTENANCE_JOBS.importImagesSweep, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.emailSweep,
  { every: 30_000 },
  { name: MAINTENANCE_JOBS.emailSweep, opts: { removeOnComplete: 10, removeOnFail: 50 } },
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
