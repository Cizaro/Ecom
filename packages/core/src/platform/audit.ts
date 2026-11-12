import type { Logger } from "./logger";

/** JSON that can be stored in the audit log's before/after columns. */
export type AuditJson =
  string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

export type AuditActorType = "user" | "anonymous" | "customer" | "system" | "platform_admin";

export interface AuditEntry {
  /** Null for platform-level events such as sign-in. */
  tenantId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  /** `module.verb`, for example `auth.sign_in` or `orders.refund`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: { [key: string]: AuditJson };
  after?: { [key: string]: AuditJson };
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Anything with an `auditLog.create` method: the admin client for
 * platform-level events, or a tenant-bound transaction for tenant events
 * (where Row-Level Security checks the tenant).
 */
export interface AuditWriter {
  auditLog: {
    create(args: {
      data: {
        tenantId: string | null;
        actorType: string;
        actorUserId: string | null;
        action: string;
        entityType: string;
        entityId: string | null;
        before?: { [key: string]: AuditJson };
        after?: { [key: string]: AuditJson };
        ip: string | null;
        requestId: string | null;
      };
    }): Promise<unknown>;
  };
}

/** Writes one audit-log row. The log is append-only at the database level. */
export async function recordAudit(writer: AuditWriter, entry: AuditEntry): Promise<void> {
  await writer.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorType: entry.actorType,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.before ? { before: entry.before } : {}),
      ...(entry.after ? { after: entry.after } : {}),
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}

/**
 * For events that must not fail the operation they describe (a completed
 * sign-out should not turn into an error page). Failures are logged loudly.
 */
export async function recordAuditBestEffort(
  writer: AuditWriter,
  entry: AuditEntry,
  logger: Logger,
): Promise<void> {
  try {
    await recordAudit(writer, entry);
  } catch (error) {
    logger.error({ action: entry.action, err: (error as Error).message }, "audit log write failed");
  }
}
