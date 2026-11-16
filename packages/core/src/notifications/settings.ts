import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { normalizeEmail } from "../customers/accounts";
import { MAX_EMAIL_ATTEMPTS } from "./delivery";
import { EMAIL_EVENTS } from "./enqueue";

// Store email settings for staff: who is told about new orders and low
// stock, and the emails that could not be sent.

export const MAX_STAFF_ADDRESSES = 5;

export class NotificationSettingsError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "NotificationSettingsError";
  }
}

export interface NotificationSettingsView {
  orderEmails: string[];
  stockEmails: string[];
}

/** "a@x.com, b@y.com" (commas, spaces or new lines) -> checked, lowercased, once each. */
export function parseAddressList(value: unknown, field: string): string[] {
  const parts = (typeof value === "string" ? value : "").split(/[\s,;]+/).filter(Boolean);
  const addresses: string[] = [];
  for (const part of parts) {
    const email = normalizeEmail(part);
    if (!email) {
      throw new NotificationSettingsError(`"${part.slice(0, 60)}" is not an email address.`, field);
    }
    if (!addresses.includes(email)) addresses.push(email);
  }
  if (addresses.length > MAX_STAFF_ADDRESSES) {
    throw new NotificationSettingsError(`Enter up to ${MAX_STAFF_ADDRESSES} addresses.`, field);
  }
  return addresses;
}

export async function getNotificationSettings(
  db: TenantDb,
  context: RequestContext,
): Promise<NotificationSettingsView> {
  assertPermission(context, "settings.write");
  const row = await db.run((tx) =>
    tx.notificationSettings.findFirst({ select: { orderEmails: true, stockEmails: true } }),
  );
  return { orderEmails: row?.orderEmails ?? [], stockEmails: row?.stockEmails ?? [] };
}

export async function saveNotificationSettings(
  db: TenantDb,
  context: RequestContext,
  input: { orderEmails: unknown; stockEmails: unknown },
): Promise<void> {
  assertPermission(context, "settings.write");
  const orderEmails = parseAddressList(input.orderEmails, "orderEmails");
  const stockEmails = parseAddressList(input.stockEmails, "stockEmails");
  await db.run(async (tx) => {
    const before = await tx.notificationSettings.findFirst({
      select: { orderEmails: true, stockEmails: true },
    });
    await tx.notificationSettings.upsert({
      where: { tenantId: db.tenantId },
      create: { tenantId: db.tenantId, orderEmails, stockEmails },
      update: { orderEmails, stockEmails },
    });
    await audit(
      tx,
      context,
      "settings.notifications_updated",
      { type: "notification_settings", id: db.tenantId },
      before ? { orderEmails: before.orderEmails, stockEmails: before.stockEmails } : undefined,
      { orderEmails, stockEmails },
    );
  });
}

const LABELS: Record<string, string> = {
  [EMAIL_EVENTS.orderConfirmed]: "Order confirmation",
  [EMAIL_EVENTS.orderShipped]: "Order sent",
  [EMAIL_EVENTS.paymentReceived]: "Payment received",
  [EMAIL_EVENTS.orderCancelled]: "Order cancelled",
  [EMAIL_EVENTS.staffNewOrder]: "New order (staff)",
  [EMAIL_EVENTS.staffLowStock]: "Low stock (staff)",
  [EMAIL_EVENTS.returnRecorded]: "Return recorded",
};

export interface UndeliveredEmail {
  id: string;
  label: string;
  orderId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  /** True once every attempt has failed; false while it is waiting for another try. */
  givenUp: boolean;
}

/** Emails not sent after at least one attempt, newest first. */
export async function listUndeliveredEmails(
  db: TenantDb,
  context: RequestContext,
): Promise<UndeliveredEmail[]> {
  assertPermission(context, "settings.write");
  const rows = await db.run((tx) =>
    tx.outboxEvent.findMany({
      where: { processedAt: null, type: { startsWith: "email." }, lastError: { not: null } },
      select: {
        id: true,
        type: true,
        payload: true,
        attempts: true,
        lastError: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    label: LABELS[row.type] ?? row.type,
    orderId: (row.payload as { orderId?: string } | null)?.orderId ?? null,
    attempts: row.attempts,
    // Provider errors can be long; the full text stays in the database.
    lastError: row.lastError?.slice(0, 200) ?? null,
    createdAt: row.createdAt,
    givenUp: row.attempts >= MAX_EMAIL_ATTEMPTS,
  }));
}

/** Tries an email again from the start (staff fixed the address or the mail settings). */
export async function retryEmail(
  db: TenantDb,
  context: RequestContext,
  eventId: string,
): Promise<void> {
  assertPermission(context, "settings.write");
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new NotFoundError("email");
  await db.run(async (tx) => {
    const updated = await tx.outboxEvent.updateMany({
      where: { id: eventId, processedAt: null, type: { startsWith: "email." } },
      data: { attempts: 0, availableAt: new Date(), lockedUntil: null },
    });
    if (updated.count === 0) throw new NotFoundError("email");
    await audit(tx, context, "settings.email_retried", { type: "outbox_event", id: eventId });
  });
}
