import { getAdminPrisma } from "@ecom/db";
import { MAX_EMAIL_ATTEMPTS } from "../notifications/delivery";

/**
 * Tenants with emails waiting to be sent, for the worker. Uses the admin
 * connection and returns tenant IDs only; each tenant's emails are then sent
 * inside that tenant.
 */
export async function listTenantsWithPendingEmails(
  adminDatabaseUrl: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await getAdminPrisma(adminDatabaseUrl).outboxEvent.findMany({
    where: {
      processedAt: null,
      type: { startsWith: "email." },
      availableAt: { lte: now },
      attempts: { lt: MAX_EMAIL_ATTEMPTS },
      tenantId: { not: null },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take: 500,
  });
  return rows.map((row) => row.tenantId!);
}
