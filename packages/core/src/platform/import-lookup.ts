import { getAdminPrisma } from "@ecom/db";

/**
 * Tenants with picture links from product imports waiting to be downloaded,
 * for the worker. Uses the admin connection and returns tenant IDs only; the
 * downloads then run inside each tenant.
 */
export async function listTenantsWithPendingImportImages(
  adminDatabaseUrl: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await getAdminPrisma(adminDatabaseUrl).productImportImage.findMany({
    where: {
      status: "pending",
      availableAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 500,
  });
  return rows.map((row) => row.tenantId);
}
