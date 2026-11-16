import { getAdminPrisma } from "@ecom/db";

/**
 * Tenants that have stock holds whose time has run out. Uses the admin
 * connection because it looks across tenants; it returns tenant IDs only,
 * and the releasing itself runs inside each tenant.
 */
export async function listTenantsWithExpiredReservations(
  adminDatabaseUrl: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await getAdminPrisma(adminDatabaseUrl).stockReservation.findMany({
    where: { status: "active", expiresAt: { lt: now } },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 500,
  });
  return rows.map((row) => row.tenantId);
}
