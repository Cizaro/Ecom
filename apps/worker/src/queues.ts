/**
 * Queue names, one per concern (ARCHITECTURE.md section 6). Only `maintenance`
 * has a consumer so far; the others get theirs with the features that need them.
 */
export const QUEUES = {
  maintenance: "maintenance",
} as const;

export const MAINTENANCE_JOBS = {
  heartbeat: "heartbeat",
} as const;
