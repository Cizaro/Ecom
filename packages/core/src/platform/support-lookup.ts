import { getAdminPrisma } from "@ecom/db";
import { SUPPORT_AI_MAX_ATTEMPTS } from "../support/support-ai";

/**
 * Stores with customer messages the AI has not looked at yet (open
 * conversations only), for the worker. Uses the admin connection and returns
 * tenant IDs only; each store's messages are then handled inside that store.
 */
export async function listTenantsWithSupportToCheck(adminUrl: string): Promise<string[]> {
  const rows = await getAdminPrisma(adminUrl).$queryRaw<{ tenant_id: string }[]>`
    SELECT DISTINCT c.tenant_id
    FROM support_conversations c
    WHERE c.status = 'open'
      AND c.ai_check_attempts < ${SUPPORT_AI_MAX_ATTEMPTS}
      AND EXISTS (
        SELECT 1 FROM support_messages m
        WHERE m.conversation_id = c.id
          AND m.author_type = 'customer'
          AND (c.ai_checked_message_id IS NULL OR m.id > c.ai_checked_message_id)
      )
    LIMIT 200`;
  return rows.map((row) => row.tenant_id);
}
