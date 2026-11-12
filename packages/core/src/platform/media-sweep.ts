import { getAdminPrisma } from "@ecom/db";
import type { MediaProcessingJob } from "../media/assets";

/**
 * Uploads still waiting for their resized versions after `olderThanMs`,
 * across all tenants. Normally the upload queues the job itself; this covers
 * the case where the queue was unreachable at that moment.
 *
 * Uses the admin connection because it looks across tenants. It returns
 * identifiers only; the processing itself runs inside each asset's tenant.
 */
export async function listUnprocessedMedia(
  adminDatabaseUrl: string,
  olderThanMs: number,
  limit = 100,
): Promise<MediaProcessingJob[]> {
  const rows = await getAdminPrisma(adminDatabaseUrl).mediaAsset.findMany({
    where: { status: "processing", createdAt: { lt: new Date(Date.now() - olderThanMs) } },
    select: { id: true, tenantId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((row) => ({ tenantId: row.tenantId, assetId: row.id }));
}
