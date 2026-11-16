import "server-only";

import { getEnv } from "@ecom/config";
import {
  createEmailProvider,
  createLogger,
  deliverPendingEmails,
  type EmailProvider,
  type TenantDb,
} from "@ecom/core";

// Store emails are saved with the change they report (see
// notifications/enqueue.ts in @ecom/core). After a request makes such a
// change it sends that store's waiting emails straight away, so shoppers
// hear at once; anything that fails here is retried by the worker. A failure
// never undoes or blocks the change itself.

const globals = globalThis as typeof globalThis & { __storeEmail?: EmailProvider };

export async function sendWaitingEmails(db: TenantDb): Promise<void> {
  const env = getEnv();
  const logger = createLogger("web", env.LOG_LEVEL);
  globals.__storeEmail ??= createEmailProvider(env, logger);
  try {
    const result = await deliverPendingEmails(db, globals.__storeEmail, {
      appUrl: env.APP_URL,
      accessSecret: env.ENCRYPTION_KEY,
      limit: 20,
    });
    if (result.failed > 0) {
      logger.warn({ tenantId: db.tenantId, failed: result.failed }, "store emails will be retried");
    }
  } catch (error) {
    logger.error(
      { tenantId: db.tenantId, err: error instanceof Error ? error.message : String(error) },
      "store emails not sent now; the worker will retry",
    );
  }
}
