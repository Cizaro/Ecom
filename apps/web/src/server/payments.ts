import "server-only";

import { getEnv } from "@ecom/config";
import {
  createLogger,
  createMockPaymentProvider,
  createTenantDb,
  findPaymentTenant,
  handlePaymentNotification,
  WebhookError,
  type MockPaymentProvider,
  type NotificationOutcome,
  type PaymentProvider,
} from "@ecom/core";
import { getAppPrisma } from "@ecom/db";
import { sendWaitingEmails } from "./notifications";

// Payments for the web app: the configured provider, and the one path every
// payment notification takes, whether it arrives at the webhook URL or from
// the mock provider's test page.

const globals = globalThis as typeof globalThis & {
  __paymentProvider?: MockPaymentProvider;
};

export function getMockProvider(): MockPaymentProvider {
  const env = getEnv();
  // parseEnv guarantees the secret is set when the provider is the mock.
  globals.__paymentProvider ??= createMockPaymentProvider({
    webhookSecret: env.MOCK_PAYMENT_WEBHOOK_SECRET!,
  });
  return globals.__paymentProvider;
}

/** The online payment provider, or null when the store takes cash on delivery only. */
export function getPaymentProvider(): PaymentProvider | null {
  return getEnv().PAYMENT_PROVIDER === "mock" ? getMockProvider() : null;
}

export interface DeliveryResult {
  outcome: NotificationOutcome | "rejected";
}

/**
 * Verifies a payment notification and acts on it inside the payment's own
 * store. A notification that fails verification is refused and changes
 * nothing. When an order has just been paid, its confirmation email is sent;
 * a failure to send does not undo the payment (it is logged).
 */
export async function deliverPaymentNotification(
  rawBody: string,
  headers: Headers,
): Promise<DeliveryResult> {
  const env = getEnv();
  const logger = createLogger("web", env.LOG_LEVEL);
  const provider = getPaymentProvider();
  if (!provider) return { outcome: "rejected" };
  let notification;
  try {
    notification = provider.verifyNotification(rawBody, headers);
  } catch (error) {
    // Verification only reads and checks; any failure there means the
    // notification cannot be trusted. (No instanceof check: bundling can load
    // the error class twice, and a forged notification must never cause a 500.)
    logger.warn(
      {
        reason: error instanceof Error ? error.message : String(error),
        expected: error instanceof WebhookError,
      },
      "payment notification refused",
    );
    return { outcome: "rejected" };
  }
  const tenantId = await findPaymentTenant(env.DATABASE_ADMIN_URL, notification.providerPaymentId);
  if (!tenantId) return { outcome: "unknown_payment" };
  const db = createTenantDb(getAppPrisma(env.DATABASE_URL), { tenantId });
  const result = await handlePaymentNotification(db, provider.name, notification);
  // A paid order saved its confirmation and staff emails; send them now.
  if (result.outcome === "paid") await sendWaitingEmails(db);
  if (result.outcome === "mismatch" || result.outcome === "paid_after_cancellation") {
    logger.warn({ tenantId, outcome: result.outcome }, "payment needs attention");
  }
  return { outcome: result.outcome };
}
