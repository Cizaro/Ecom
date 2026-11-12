import { withTenant, type AppPrismaClient } from "@ecom/db";

export interface StoreHost {
  tenantId: string;
  storeId: string;
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Canonical form of a Host header: lowercase, port and trailing dot removed.
 * Returns null for anything that is not a plain host name, so odd input never
 * reaches the database.
 */
export function normalizeHost(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null;
  let host = hostHeader.trim().toLowerCase();
  // IPv6 literals ([::1]:3000) are not store domains.
  if (host.startsWith("[")) return null;
  host = host.replace(/:\d+$/, "").replace(/\.$/, "");
  if (host.length === 0 || host.length > 253 || !HOSTNAME.test(host)) return null;
  return host;
}

/**
 * Finds the store a storefront request is for, before any tenant context
 * exists. Runs as the restricted runtime role through a database function
 * that can return only the (tenant, store) pair for one exact host name.
 */
export async function resolveStoreHost(
  prisma: AppPrismaClient,
  hostHeader: string | null | undefined,
): Promise<StoreHost | null> {
  const host = normalizeHost(hostHeader);
  if (!host) return null;
  const rows = await prisma.$queryRaw<{ tenant_id: string; store_id: string }[]>`
    SELECT tenant_id, store_id FROM app_private.resolve_store_host(${host})`;
  const row = rows[0];
  return row ? { tenantId: row.tenant_id, storeId: row.store_id } : null;
}

export interface Storefront extends StoreHost {
  name: string;
  defaultLocale: string;
  defaultCurrency: string;
}

/**
 * The store for a storefront request, with what the shell needs to render.
 * Null when no active store answers to this host name.
 */
export async function loadStorefront(
  prisma: AppPrismaClient,
  hostHeader: string | null | undefined,
): Promise<Storefront | null> {
  const host = await resolveStoreHost(prisma, hostHeader);
  if (!host) return null;
  const store = await withTenant(prisma, { tenantId: host.tenantId }, (tx) =>
    tx.store.findUnique({
      where: { id: host.storeId },
      select: { name: true, defaultLocale: true, defaultCurrency: true },
    }),
  );
  return store ? { ...host, ...store } : null;
}
