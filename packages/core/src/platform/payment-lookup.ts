import { getAdminPrisma } from "@ecom/db";

/**
 * Which tenant a payment belongs to, from the provider's reference. A
 * provider's notification does not arrive through a store's address, so this
 * lookup uses the admin connection; it returns the tenant ID only, and the
 * notification is then handled inside that tenant.
 */
export async function findPaymentTenant(
  adminDatabaseUrl: string,
  providerPaymentId: string,
): Promise<string | null> {
  if (providerPaymentId.length > 200) return null;
  const payment = await getAdminPrisma(adminDatabaseUrl).payment.findUnique({
    where: { providerPaymentId },
    select: { tenantId: true },
  });
  return payment?.tenantId ?? null;
}

/** Tenants with unpaid orders whose time to pay has run out. */
export async function listTenantsWithExpiredOrders(
  adminDatabaseUrl: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await getAdminPrisma(adminDatabaseUrl).order.findMany({
    where: { status: "pending_payment", payBy: { lt: now } },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 500,
  });
  return rows.map((row) => row.tenantId);
}
