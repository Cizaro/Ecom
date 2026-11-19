import { getAdminPrisma } from "@ecom/db";

/**
 * Which store a Meta webhook notification is for, from the Page or Instagram
 * account it names. Notifications do not arrive through a store's address,
 * so this uses the admin connection and returns identifiers only; the items
 * are then stored inside that tenant.
 */
export async function findSocialConnection(
  adminDatabaseUrl: string,
  channel: "facebook" | "instagram",
  accountId: string,
): Promise<{ tenantId: string; connectionId: string } | null> {
  if (!/^[0-9]{1,30}$/.test(accountId)) return null;
  const row = await getAdminPrisma(adminDatabaseUrl).socialConnection.findFirst({
    where:
      channel === "facebook"
        ? { provider: "meta", pageId: accountId }
        : { provider: "meta", instagramAccountId: accountId },
    select: { id: true, tenantId: true },
  });
  return row ? { tenantId: row.tenantId, connectionId: row.id } : null;
}
