import type { AppPrismaClient, AppTransaction } from "./clients";

export interface TenantContext {
  tenantId: string;
  /** The signed-in staff user, when there is one. */
  userId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in a transaction bound to one tenant. Row-Level Security then
 * limits every query in the callback to that tenant's rows.
 *
 * The settings are transaction-local, so they cannot leak to another request
 * that later reuses the same pooled connection.
 */
export async function withTenant<T>(
  prisma: AppPrismaClient,
  context: TenantContext,
  work: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(context.tenantId)) {
    throw new Error("withTenant: tenantId is not a UUID");
  }
  if (context.userId !== undefined && !UUID.test(context.userId)) {
    throw new Error("withTenant: userId is not a UUID");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.tenant_id', ${context.tenantId}, true),
             set_config('app.user_id', ${context.userId ?? ""}, true)`;
    return work(tx);
  });
}
