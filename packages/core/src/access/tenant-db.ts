import { withTenant, type AppPrismaClient, type AppTransaction } from "@ecom/db";
import { recordAudit, type AuditJson } from "../platform/audit";
import type { RequestContext } from "./context";

/**
 * A database handle already bound to one tenant. Domain services receive this
 * instead of a Prisma client, so they cannot forget to scope a query: every
 * `run` is a transaction in which Row-Level Security limits all reads and
 * writes to the context's tenant.
 */
export interface TenantDb {
  readonly tenantId: string;
  run<T>(work: (tx: AppTransaction) => Promise<T>): Promise<T>;
}

export function createTenantDb(
  prisma: AppPrismaClient,
  /** Background jobs act for a tenant without a signed-in user. */
  context: { tenantId: string; userId?: string },
): TenantDb {
  const binding = { tenantId: context.tenantId, userId: context.userId };
  return {
    tenantId: context.tenantId,
    run: (work) => withTenant(prisma, binding, work),
  };
}

export interface AuditTarget {
  type: string;
  id?: string | null;
}

/**
 * Records a sensitive action taken in a tenant. Call it inside the same
 * `TenantDb.run` transaction as the change, so the change and its audit entry
 * are committed (or rolled back) together.
 */
export async function audit(
  tx: AppTransaction,
  context: RequestContext,
  action: string,
  entity: AuditTarget,
  before?: { [key: string]: AuditJson },
  after?: { [key: string]: AuditJson },
): Promise<void> {
  await recordAudit(tx, {
    tenantId: context.tenantId,
    actorType: "user",
    actorUserId: context.userId,
    action,
    entityType: entity.type,
    entityId: entity.id ?? null,
    before,
    after,
    ip: context.ip,
    requestId: context.requestId,
  });
}
