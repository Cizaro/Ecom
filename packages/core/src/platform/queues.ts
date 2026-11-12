import { Queue } from "bullmq";
import type { MediaProcessingJob } from "../media/assets";
import { redisConnectionOptions } from "./redis";

/**
 * Queue and job names, shared by the code that adds jobs (the web app) and
 * the worker that runs them. One queue per concern (ARCHITECTURE.md section 6).
 */
export const QUEUES = {
  maintenance: "maintenance",
  media: "media",
} as const;

export const MAINTENANCE_JOBS = {
  heartbeat: "heartbeat",
  /** Finds uploads whose resized versions were never made and queues them. */
  mediaSweep: "media-sweep",
} as const;

export const MEDIA_JOBS = {
  process: "process",
} as const;

const queues = new Map<string, Queue>();

function getQueue(redisUrl: string, name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: {
        ...redisConnectionOptions(redisUrl),
        // A request must not hang when Redis is down: fail and let the caller decide.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      },
    });
    // Connection problems surface through the awaited calls.
    queue.on("error", () => {});
    queues.set(name, queue);
  }
  return queue;
}

/**
 * Queues the job that makes an image's resized versions. The asset ID is the
 * job ID, so queueing the same asset twice does not run it twice at once.
 */
export async function enqueueMediaProcessing(
  redisUrl: string,
  job: MediaProcessingJob,
): Promise<void> {
  await getQueue(redisUrl, QUEUES.media).add(MEDIA_JOBS.process, job, {
    jobId: job.assetId,
    attempts: 4,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/** Closes queue connections so short-lived scripts and tests can exit. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
