import "server-only";

import { getEnv } from "@ecom/config";
import {
  createEmailProvider,
  createLogger,
  createMockPaymentProvider,
  createTenantDb,
  findPaymentTenant,
  handlePaymentNotification,
  orderAccessKey,
  orderConfirmationEmail,
  WebhookError,
  type EmailProvider,
  type MockPaymentProvider,
  type NotificationOutcome,
  type OrderView,
  type PaymentProvider,
  type TenantDb,
} from "@ecom/core";
import { getAppPrisma } from "@ecom/db";

// Payments for the web app: the configured provider, and the one path every
// payment notification takes, whether it arrives at the webhook URL or from
// the mock provider's test page.

const globals = globalThis as typeof globalThis & {
  __paymentProvider?: MockPaymentProvider;
  __orderEmail?: EmailProvider;
};

export function getMockProvider(): MockPaymentProvider {
  const env = getEnv();
  // parseEnv guarantees the secret is set when the provider is the mock.
  globals.__paymentProvider ??= createMockPaymentProvider({
    webhookSecret: env.MOCK_PAYMENT_WEBHOOK_SECRET!,
  });
  return globals.__paymentProvider;
}

export function getPaymentProvider(): PaymentProvider {
  return getMockProvider();
}

/**
 * The address of a tenant's store for links in emails: its primary domain
 * (or any domain), with the scheme and port of the app's own address.
 */
async function storeLinks(db: TenantDb): Promise<{ name: string; url: string }> {
  const appUrl = new URL(getEnv().APP_URL);
  const store = await db.run(async (tx) => ({
    store: await tx.store.findFirst({ select: { name: true }, orderBy: { createdAt: "asc" } }),
    domain: await tx.storeDomain.findFirst({
      select: { hostname: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  }));
  const url = store.domain
    ? `${appUrl.protocol}//${store.domain.hostname}${appUrl.port ? `:${appUrl.port}` : ""}`
    : appUrl.origin;
  return { name: store.store?.name ?? "Store", url };
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
  if (result.outcome === "paid" && result.order) {
    await sendConfirmation(db, result.order).catch((error: unknown) =>
      logger.error(
        { orderId: result.order!.id, err: error instanceof Error ? error.message : String(error) },
        "order confirmation email failed",
      ),
    );
  }
  if (result.outcome === "mismatch" || result.outcome === "paid_after_cancellation") {
    logger.warn({ tenantId, outcome: result.outcome }, "payment needs attention");
  }
  return { outcome: result.outcome };
}

async function sendConfirmation(db: TenantDb, order: OrderView) {
  const env = getEnv();
  globals.__orderEmail ??= createEmailProvider(env, createLogger("web", env.LOG_LEVEL));
  const store = await storeLinks(db);
  // A signed-in customer's order is in their account; a guest's opens from this link only.
  const orderUrl = order.customerId
    ? `${store.url}/account/orders/${order.id}`
    : `${store.url}/order/${order.id}?key=${orderAccessKey(env.ENCRYPTION_KEY, order.id)}`;
  await globals.__orderEmail.send(orderConfirmationEmail(order, store, orderUrl));
}
