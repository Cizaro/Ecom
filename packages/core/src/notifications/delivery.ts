import { isLocale } from "@ecom/i18n";
import type { AppTransaction } from "@ecom/db";
import type { TenantDb } from "../access/tenant-db";
import { orderAccessKey, orderViewIn, type OrderView } from "../orders/orders";
import { supportAccessKey } from "../support/support";
import type { EmailMessage, EmailProvider } from "./email";
import { EMAIL_EVENTS, type EmailPayload } from "./enqueue";
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderShippedEmail,
  paymentReceivedEmail,
  returnRecordedEmail,
  staffSupportMessageEmail,
  supportReceivedEmail,
  supportReplyEmail,
  staffLowStockEmail,
  staffNewOrderEmail,
  type StoreLinks,
} from "./order-emails";

// Sends the emails saved in outbox_events. Runs inside one store (Row-Level
// Security applies): straight after a request that saved some, and in the
// worker every few seconds for anything left over or failed. Each email is
// claimed before sending, so two senders never send the same one, and marked
// sent afterwards. A failed email is tried again later, up to MAX_ATTEMPTS.

export const MAX_EMAIL_ATTEMPTS = 6;
/** Minutes to wait after the 1st, 2nd, ... failed attempt. */
const RETRY_MINUTES = [1, 5, 30, 120, 720];
/** A claimed email not marked sent by then (sender crashed) can be claimed again. */
const CLAIM_MINUTES = 5;

export interface EmailDeliveryOptions {
  /** The app's own address, for admin links and the scheme and port of store links. */
  appUrl: string;
  /** Server secret guest order links are derived from (see orderAccessKey). */
  accessSecret: string;
  limit?: number;
}

/**
 * The address of a tenant's store for links in emails: its primary domain
 * (or any domain), with the scheme and port of the app's own address.
 */
export async function storeLinksIn(tx: AppTransaction, appUrl: string): Promise<StoreLinks> {
  const app = new URL(appUrl);
  const [store, domain] = await Promise.all([
    tx.store.findFirst({ select: { name: true }, orderBy: { createdAt: "asc" } }),
    tx.storeDomain.findFirst({
      select: { hostname: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  const url = domain
    ? `${app.protocol}//${domain.hostname}${app.port ? `:${app.port}` : ""}`
    : app.origin;
  return { name: store?.name ?? "Store", url };
}

/** Where the shopper opens the order: their account, or the guest's keyed link. */
export function shopperOrderUrl(order: OrderView, store: StoreLinks, accessSecret: string): string {
  return order.customerId
    ? `${store.url}/account/orders/${order.id}`
    : `${store.url}/order/${order.id}?key=${orderAccessKey(accessSecret, order.id)}`;
}

interface ClaimedEvent {
  id: string;
  type: string;
  payload: EmailPayload;
  attempts: number;
  created_at: Date;
}

/** What to send for one saved event, or null when there is nothing to send any more. */
async function render(
  tx: AppTransaction,
  event: ClaimedEvent,
  options: EmailDeliveryOptions,
): Promise<EmailMessage | null> {
  const store = await storeLinksIn(tx, options.appUrl);
  const admin = new URL(options.appUrl).origin;
  const { payload } = event;

  if (event.type === EMAIL_EVENTS.staffLowStock) {
    if (!payload.variantId || !payload.to) return null;
    const variant = await tx.productVariant.findUnique({
      where: { id: payload.variantId },
      select: { sku: true, color: true, size: true, product: { select: { name: true } } },
    });
    if (!variant) return null;
    return staffLowStockEmail(
      {
        variantId: payload.variantId,
        productName: variant.product.name,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        available: payload.available ?? 0,
      },
      store,
      `${admin}/admin/inventory/${payload.variantId}`,
      payload.to,
    );
  }

  if (payload.conversationId) {
    const conversation = await tx.supportConversation.findUnique({
      where: { id: payload.conversationId },
      select: {
        id: true,
        subject: true,
        name: true,
        email: true,
        customerId: true,
        locale: true,
        messages: {
          where: payload.messageId ? { id: payload.messageId } : { authorType: "customer" },
          select: { authorName: true, body: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
    });
    const message = conversation?.messages[0];
    if (!conversation || !message) return null;
    const data = {
      ...conversation,
      message,
      locale: isLocale(conversation.locale) ? conversation.locale : undefined,
    };
    const link = conversation.customerId
      ? `${store.url}/account/messages/${conversation.id}`
      : `${store.url}/support/${conversation.id}?key=${supportAccessKey(options.accessSecret, conversation.id)}`;
    switch (event.type) {
      case EMAIL_EVENTS.supportReceived:
        return supportReceivedEmail(data, store, link);
      case EMAIL_EVENTS.supportReply:
        return supportReplyEmail(data, store, link);
      case EMAIL_EVENTS.staffSupportMessage:
        return payload.to
          ? staffSupportMessageEmail(
              data,
              store,
              `${admin}/admin/inbox/${conversation.id}`,
              payload.to,
            )
          : null;
      default:
        return null;
    }
  }

  if (!payload.orderId) return null;
  const order = await orderViewIn(tx, payload.orderId);
  if (!order) return null;
  const url = shopperOrderUrl(order, store, options.accessSecret);
  switch (event.type) {
    case EMAIL_EVENTS.orderConfirmed:
      return orderConfirmationEmail(order, store, url);
    case EMAIL_EVENTS.orderShipped:
      return orderShippedEmail(order, store, url);
    case EMAIL_EVENTS.paymentReceived:
      return paymentReceivedEmail(order, store, url);
    case EMAIL_EVENTS.orderCancelled:
      return orderCancelledEmail(order, store, url, payload.reason ?? "staff");
    case EMAIL_EVENTS.returnRecorded:
      return payload.returnId ? returnRecordedEmail(order, store, url, payload.returnId) : null;
    case EMAIL_EVENTS.staffNewOrder:
      return payload.to
        ? staffNewOrderEmail(order, store, `${admin}/admin/orders/${order.id}`, payload.to)
        : null;
    default:
      return null;
  }
}

/**
 * Sends this store's waiting emails, oldest first. Returns how many were
 * sent and how many failed (and will be tried again later).
 */
export async function deliverPendingEmails(
  db: TenantDb,
  provider: EmailProvider,
  options: EmailDeliveryOptions,
): Promise<{ sent: number; failed: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const claimed = await db.run(
    (tx) => tx.$queryRaw<ClaimedEvent[]>`
      UPDATE outbox_events
         SET locked_until = now() + make_interval(mins => ${CLAIM_MINUTES}),
             attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox_events
          WHERE processed_at IS NULL
            AND type LIKE 'email.%'
            AND available_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
            AND attempts < ${MAX_EMAIL_ATTEMPTS}
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts, created_at`,
  );

  // RETURNING does not keep the subquery's order: send oldest first, so an
  // order's emails arrive in the order things happened.
  claimed.sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
  );
  let sent = 0;
  let failed = 0;
  for (const event of claimed) {
    try {
      const message = await db.run((tx) => render(tx, event, options));
      if (message) await provider.send(message);
      await db.run((tx) =>
        tx.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), lockedUntil: null, lastError: null },
        }),
      );
      if (message) sent += 1;
    } catch (error) {
      failed += 1;
      const wait = RETRY_MINUTES[Math.min(event.attempts - 1, RETRY_MINUTES.length - 1)]!;
      await db.run((tx) =>
        tx.outboxEvent.update({
          where: { id: event.id },
          data: {
            lockedUntil: null,
            availableAt: new Date(Date.now() + wait * 60_000),
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          },
        }),
      );
    }
  }
  return { sent, failed };
}
