import type { AppTransaction, Prisma } from "@ecom/db";

// Emails are saved in the same transaction as the change they report (an
// order placed, sent, paid or cancelled), as rows in outbox_events. If the
// change is rolled back, so is the email; if it commits, the email is sent
// afterwards and retried until it goes. A dedupe key makes each email once
// only, however often the change is reported.

export const EMAIL_EVENTS = {
  orderConfirmed: "email.order_confirmed",
  orderShipped: "email.order_shipped",
  paymentReceived: "email.payment_received",
  orderCancelled: "email.order_cancelled",
  staffNewOrder: "email.staff_new_order",
  staffLowStock: "email.staff_low_stock",
  returnRecorded: "email.return_recorded",
  supportReceived: "email.support_received",
  supportReply: "email.support_reply",
  staffSupportMessage: "email.staff_support_message",
} as const;

export type EmailEventType = (typeof EMAIL_EVENTS)[keyof typeof EMAIL_EVENTS];

export interface EmailPayload {
  orderId?: string;
  variantId?: string;
  returnId?: string;
  conversationId?: string;
  messageId?: string;
  /** Staff emails: the address it goes to. Shopper emails go to the order's email. */
  to?: string;
  /** Order cancelled: why. */
  reason?: "expired" | "staff";
  /** Low stock: how many were left when it was noticed. */
  available?: number;
}

export async function enqueueEmailIn(
  tx: AppTransaction,
  tenantId: string,
  type: EmailEventType,
  payload: EmailPayload,
  dedupeKey: string,
): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [
      {
        tenantId,
        type,
        payload: payload as Prisma.InputJsonObject,
        dedupeKey: dedupeKey.slice(0, 300),
      },
    ],
    skipDuplicates: true,
  });
}

/** The store's staff addresses for a kind of email (none until staff add some). */
export async function staffAddressesIn(
  tx: AppTransaction,
  kind: "order" | "stock" | "support",
): Promise<string[]> {
  const settings = await tx.notificationSettings.findFirst({
    select: { orderEmails: true, stockEmails: true, supportEmails: true },
  });
  const lists = {
    order: settings?.orderEmails,
    stock: settings?.stockEmails,
    support: settings?.supportEmails,
  };
  return lists[kind] ?? [];
}

/** A staff email for each address on the store's list, once each. */
export async function enqueueStaffEmailsIn(
  tx: AppTransaction,
  tenantId: string,
  kind: "order" | "stock" | "support",
  type: EmailEventType,
  payload: Omit<EmailPayload, "to">,
  dedupeKey: string,
): Promise<void> {
  for (const to of await staffAddressesIn(tx, kind)) {
    await enqueueEmailIn(tx, tenantId, type, { ...payload, to }, `${dedupeKey}:${to}`);
  }
}
