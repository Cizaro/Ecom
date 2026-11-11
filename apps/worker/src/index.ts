import { getEnv } from "@ecom/config";
import { createLogger, redisConnectionOptions } from "@ecom/core";
import { Queue, Worker } from "bullmq";
import { MAINTENANCE_JOBS, QUEUES } from "./queues";

const env = getEnv();
const logger = createLogger("worker", env.LOG_LEVEL);

// BullMQ requires maxRetriesPerRequest to be null on worker connections.
const connection = { ...redisConnectionOptions(env.REDIS_URL), maxRetriesPerRequest: null };

const maintenanceQueue = new Queue(QUEUES.maintenance, { connection });

const maintenanceWorker = new Worker(
  QUEUES.maintenance,
  async (job) => {
    switch (job.name) {
      case MAINTENANCE_JOBS.heartbeat:
        logger.debug({ jobId: job.id }, "heartbeat");
        return { at: new Date().toISOString() };
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  },
  { connection },
);

maintenanceWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, err: error.message }, "job failed");
});
maintenanceWorker.on("error", (error) => {
  logger.error({ err: error.message }, "worker error");
});

// A repeatable job proves the queue, scheduler and consumer are wired together.
await maintenanceQueue.upsertJobScheduler(
  MAINTENANCE_JOBS.heartbeat,
  { every: 60_000 },
  { name: MAINTENANCE_JOBS.heartbeat, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

logger.info({ queues: Object.values(QUEUES) }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker shutting down");
  await maintenanceWorker.close();
  await maintenanceQueue.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
