import { createHash, createHmac, randomUUID } from "node:crypto";
import type { AppTransaction, Prisma } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { checkoutCartIn, convertCartIn, type CartOwner } from "../cart/cart";
import { normalizeEmail } from "../customers/accounts";
import {
  formatAddress,
  validateAddress,
  type AddressInput,
  type ValidAddress,
} from "../customers/addresses";
import {
  InventoryError,
  reserveStockIn,
  returnCommittedIn,
  settleReservationsIn,
} from "../inventory/stock";
import { formatMoney } from "../catalog/money";
import type { EmailMessage } from "../notifications/email";
import type { PaymentNotification, PaymentProvider } from "../payments/provider";

// Orders. Rules this file keeps:
//
// - An order is built on the server from the cart as it is now: prices come
//   from the catalog, never from the browser, and are copied into the order
//   so later catalog changes never alter it.
// - Placing an order holds its stock in the same transaction; if anything
//   cannot be had, no order is made.
// - Only a verified notification from the payment provider marks an order
//   paid. Each notification is acted on once, however often it arrives, and
//   only if its amount and currency match the payment.
// - A guest's order can be opened only with the key in its confirmation
//   link; a signed-in customer's only by that customer. Guest orders belong
//   to no account, so nobody can put an order into someone else's account by
//   typing their email address.

export const PAY_WITHIN_MINUTES = 30;
export const ORDER_PAGE_SIZE = 25;

export const PAYMENT_METHODS = ["online", "cash_on_delivery"] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];
/**
 * How long a cash-on-delivery order keeps its stock held before it is sent.
 * Holds expire after this; staff should send or cancel long before.
 */
export const COD_HOLD_DAYS = 30;

export const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export type OrderErrorCode =
  "empty_cart" | "cart_changed" | "out_of_stock" | "invalid" | "not_payable" | "not_allowed";

/** A checkout or order request refused for a reason the shopper or staff can act on. Safe to show. */
export class OrderError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "OrderError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * The key in an order's private link. Derived from the order ID and a server
 * secret, so the confirmation email (sent later, when payment arrives) can
 * carry it again, while nobody without the secret can work it out. Only its
 * hash is stored. Changing the secret makes earlier links stop working.
 */
export function orderAccessKey(secret: string, orderId: string): string {
  return createHmac("sha256", secret).update(`order-access:${orderId}`).digest("base64url");
}

function assertOrderId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID.test(id)) throw new NotFoundError("order");
}

// --- What an order looks like ------------------------------------------------

export interface OrderView {
  id: string;
  number: number;
  status: OrderStatusValue;
  paymentMethod: PaymentMethodValue;
  email: string;
  customerId: string | null;
  currency: string;
  subtotalAmount: number;
  shippingAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  shippingAddress: ValidAddress;
  placedAt: Date;
  paidAt: Date | null;
  payBy: Date;
  items: {
    id: string;
    productName: string;
    sku: string;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPriceAmount: number;
    lineTotalAmount: number;
  }[];
  /** Newest first. Only what the provider reported for display; never card numbers. */
  payments: {
    id: string;
    status: "pending" | "succeeded" | "failed" | "cancelled";
    amount: number;
    methodBrand: string | null;
    methodLast4: string | null;
    failureMessage: string | null;
    createdAt: Date;
  }[];
}

export interface StaffOrderView extends OrderView {
  events: {
    id: string;
    type: string;
    fromStatus: OrderStatusValue | null;
    toStatus: OrderStatusValue | null;
    actorType: string;
    actorName: string | null;
    note: string | null;
    createdAt: Date;
  }[];
}

const ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentMethod: true,
  email: true,
  customerId: true,
  currency: true,
  subtotalAmount: true,
  shippingAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  shippingAddress: true,
  placedAt: true,
  paidAt: true,
  payBy: true,
  items: {
    select: {
      id: true,
      productName: true,
      sku: true,
      color: true,
      size: true,
      quantity: true,
      unitPriceAmount: true,
      lineTotalAmount: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  payments: {
    select: {
      id: true,
      status: true,
      amount: true,
      methodBrand: true,
      methodLast4: true,
      failureMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

const toView = (row: OrderRow): OrderView => ({
  ...row,
  shippingAddress: row.shippingAddress as unknown as ValidAddress,
});

// --- Placing an order --------------------------------------------------------

export interface PlaceOrderInput {
  owner: CartOwner;
  /** The signed-in customer, from their session; null for a guest. */
  customer: { id: string; email: string } | null;
  /** A guest's email. Ignored for a signed-in customer (their account email is used). */
  email?: unknown;
  address: AddressInput;
  /** The total the shopper saw. If prices changed since, the order is not placed. */
  expectedTotal?: number;
  /** Server secret the order's link key is derived from (see orderAccessKey). */
  accessSecret: string;
  /** Defaults to online. Cash on delivery needs a phone number for the courier. */
  paymentMethod?: PaymentMethodValue;
}

export interface PlacedOrder {
  orderId: string;
  number: number;
  /** For the guest's confirmation link. Shown once; only its hash is stored. */
  accessKey: string;
  paymentMethod: PaymentMethodValue;
  /** Set for cash on delivery: the order as placed, for its confirmation email. */
  order?: OrderView;
}

async function nextOrderNumber(tx: AppTransaction, tenantId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ next_number: number }[]>`
    INSERT INTO order_counters (tenant_id) VALUES (${tenantId}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET next_number = order_counters.next_number + 1
    RETURNING next_number`;
  return row!.next_number;
}

/**
 * Turns the shopper's cart into an order waiting for payment, holding its
 * stock for PAY_WITHIN_MINUTES. Nothing is made if the cart is empty, has
 * an item that is no longer for sale or not in stock, or its total differs
 * from what the shopper was shown.
 */
export async function placeOrder(db: TenantDb, input: PlaceOrderInput): Promise<PlacedOrder> {
  const email = input.customer ? input.customer.email : normalizeEmail(input.email);
  if (!email) throw new OrderError("invalid", "Enter a valid email address.", "email");
  let address: ValidAddress;
  try {
    address = validateAddress(input.address);
  } catch (error) {
    const problem = error as { message?: string; field?: string };
    throw new OrderError("invalid", problem.message ?? "Check the address.", problem.field);
  }

  const method: PaymentMethodValue = input.paymentMethod ?? "online";
  if (!PAYMENT_METHODS.includes(method)) {
    throw new OrderError("invalid", "Choose how you will pay.", "paymentMethod");
  }
  if (method === "cash_on_delivery" && !address.phone) {
    throw new OrderError(
      "invalid",
      "Enter a phone number so the courier can reach you for cash on delivery.",
      "phone",
    );
  }
  const cod = method === "cash_on_delivery";
  if (typeof input.accessSecret !== "string" || input.accessSecret.length < 32) {
    throw new Error("placeOrder: accessSecret must be at least 32 characters");
  }
  const orderId = randomUUID();
  const accessKey = orderAccessKey(input.accessSecret, orderId);
  try {
    return await db.run(async (tx) => {
      const cart = await checkoutCartIn(tx, input.owner);
      if (!cart || cart.view.lines.length === 0) {
        throw new OrderError("empty_cart", "Your cart is empty.");
      }
      const { view } = cart;
      if (view.lines.some((line) => !line.available || line.onlyLeft !== null)) {
        throw new OrderError(
          "cart_changed",
          "Something in your cart has changed. Please check your cart before paying.",
        );
      }
      if (input.expectedTotal !== undefined && input.expectedTotal !== view.subtotalAmount) {
        throw new OrderError(
          "cart_changed",
          "A price in your cart has changed. Please check the new total before paying.",
        );
      }

      const number = await nextOrderNumber(tx, db.tenantId);
      const order = await tx.order.create({
        data: {
          id: orderId,
          tenantId: db.tenantId,
          number,
          customerId: input.customer?.id ?? null,
          cartId: cart.id,
          email,
          accessKeyHash: hash(accessKey),
          currency: view.currency!,
          subtotalAmount: view.subtotalAmount,
          totalAmount: view.subtotalAmount,
          shippingAddress: { ...address },
          paymentMethod: method,
          status: cod ? "confirmed" : "pending_payment",
          payBy: new Date(
            Date.now() + (cod ? COD_HOLD_DAYS * 24 * 60 : PAY_WITHIN_MINUTES) * 60_000,
          ),
        },
        select: { id: true },
      });
      await tx.orderItem.createMany({
        data: view.lines.map((line) => ({
          tenantId: db.tenantId,
          orderId: order.id,
          variantId: line.variantId,
          productName: line.productName,
          sku: line.sku,
          color: line.color,
          size: line.size,
          quantity: line.quantity,
          unitPriceAmount: line.unitPriceAmount,
          lineTotalAmount: line.lineTotalAmount,
        })),
      });
      await tx.orderEvent.create({
        data: {
          tenantId: db.tenantId,
          orderId: order.id,
          type: "placed",
          toStatus: cod ? "confirmed" : "pending_payment",
          actorType: input.customer ? "customer" : "guest",
        },
      });
      await reserveStockIn(tx, db.tenantId, {
        referenceType: "order",
        referenceId: order.id,
        items: view.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
        holdMinutes: cod ? COD_HOLD_DAYS * 24 * 60 : PAY_WITHIN_MINUTES,
      });
      const placed = cod
        ? toView(
            await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: ORDER_SELECT }),
          )
        : undefined;
      return { orderId: order.id, number, accessKey, paymentMethod: method, order: placed };
    });
  } catch (error) {
    // Rolled back: no order, no hold.
    if (error instanceof InventoryError && error.code === "insufficient") {
      throw new OrderError(
        "out_of_stock",
        "An item in your cart has just sold out or run low. Please check your cart.",
      );
    }
    throw error;
  }
}

/**
 * Starts a payment for an order that is waiting for one: the first attempt,
 * or another after a decline. Any earlier unfinished attempt is given up.
 * Returns where to send the shopper to pay.
 */
export async function startPayment(
  db: TenantDb,
  provider: PaymentProvider,
  orderId: string,
  returnUrl: string,
): Promise<{ payUrl: string }> {
  assertOrderId(orderId);
  const order = await db.run((tx) =>
    tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, totalAmount: true, currency: true, payBy: true },
    }),
  );
  if (!order) throw new NotFoundError("order");
  if (order.status !== "pending_payment" || order.payBy <= new Date()) {
    throw new OrderError("not_payable", "This order cannot be paid any more.");
  }
  // The provider is asked outside any transaction: a slow provider must not hold database locks.
  const created = await provider.createPayment({
    orderId,
    amount: order.totalAmount,
    currency: order.currency,
    returnUrl,
  });
  await db.run(async (tx) => {
    await tx.payment.updateMany({
      where: { orderId, status: "pending" },
      data: { status: "cancelled" },
    });
    await tx.payment.create({
      data: {
        tenantId: db.tenantId,
        orderId,
        provider: provider.name,
        providerPaymentId: created.providerPaymentId,
        amount: order.totalAmount,
        currency: order.currency,
      },
    });
  });
  return { payUrl: created.payUrl };
}

// --- Payment notifications ---------------------------------------------------

export type NotificationOutcome =
  | "paid"
  | "failed"
  | "duplicate"
  | "already_settled"
  | "unknown_payment"
  | "mismatch"
  | "paid_after_cancellation";

export interface HandledNotification {
  outcome: NotificationOutcome;
  /** Set when the order has just been paid, for the confirmation email. */
  order?: OrderView;
}

/**
 * Acts on a verified payment notification, inside the payment's tenant.
 * The notification is recorded first; a repeat of one already recorded
 * changes nothing.
 */
export async function handlePaymentNotification(
  db: TenantDb,
  provider: string,
  notification: PaymentNotification,
): Promise<HandledNotification> {
  return db.run(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { providerPaymentId: notification.providerPaymentId },
      select: { id: true, orderId: true, status: true, amount: true, currency: true },
    });
    if (!payment) return { outcome: "unknown_payment" };

    const recorded = await tx.$executeRaw`
      INSERT INTO payment_events
        (id, tenant_id, payment_id, provider, provider_event_id, type, payload, signature_verified)
      VALUES (gen_random_uuid(), ${db.tenantId}::uuid, ${payment.id}::uuid, ${provider},
              ${notification.eventId}, ${notification.type},
              ${JSON.stringify(notification)}::jsonb, true)
      ON CONFLICT (provider, provider_event_id) DO NOTHING`;
    if (recorded === 0) return { outcome: "duplicate" };

    if (notification.amount !== payment.amount || notification.currency !== payment.currency) {
      await tx.orderEvent.create({
        data: {
          tenantId: db.tenantId,
          orderId: payment.orderId,
          type: "payment_mismatch",
          actorType: "payment_provider",
          note: `Notification for ${notification.amount} ${notification.currency} did not match the payment.`,
        },
      });
      return { outcome: "mismatch" };
    }
    if (payment.status === "succeeded" || payment.status === "failed") {
      return { outcome: "already_settled" };
    }

    if (notification.type === "payment.failed") {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          failureMessage: notification.failureMessage?.slice(0, 300) ?? "The payment failed.",
        },
      });
      await tx.orderEvent.create({
        data: {
          tenantId: db.tenantId,
          orderId: payment.orderId,
          type: "payment_failed",
          actorType: "payment_provider",
          note: notification.failureMessage?.slice(0, 300) ?? null,
        },
      });
      return { outcome: "failed" };
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "succeeded",
        methodBrand: notification.methodBrand?.slice(0, 40) ?? null,
        methodLast4: /^\d{4}$/.test(notification.methodLast4 ?? "")
          ? notification.methodLast4
          : null,
      },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      select: { status: true, cartId: true },
    });
    if (order.status !== "pending_payment") {
      // Paid after the order was cancelled (it took too long): money taken, nothing to send.
      await tx.orderEvent.create({
        data: {
          tenantId: db.tenantId,
          orderId: payment.orderId,
          type: "paid_after_cancellation",
          actorType: "payment_provider",
          note: "Payment arrived after the order was cancelled. Refund it.",
        },
      });
      return { outcome: "paid_after_cancellation" };
    }
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "paid", paidAt: new Date() },
    });
    await tx.orderEvent.create({
      data: {
        tenantId: db.tenantId,
        orderId: payment.orderId,
        type: "paid",
        fromStatus: "pending_payment",
        toStatus: "paid",
        actorType: "payment_provider",
      },
    });
    await settleReservationsIn(
      tx,
      db.tenantId,
      { referenceType: "order", referenceId: payment.orderId },
      "commit",
    );
    if (order.cartId) await convertCartIn(tx, order.cartId);
    const paid = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      select: ORDER_SELECT,
    });
    return { outcome: "paid", order: toView(paid) };
  });
}

// --- Reading orders ----------------------------------------------------------

/**
 * An order for the person asking: the signed-in customer who placed it, or
 * whoever holds the key from its confirmation link. Anyone else: not found.
 */
export async function getOrderForShopper(
  db: TenantDb,
  orderId: string,
  access: { customerId?: string | null; accessKey?: string | null },
): Promise<OrderView> {
  assertOrderId(orderId);
  const row = await db.run((tx) =>
    tx.order.findUnique({
      where: { id: orderId },
      select: { ...ORDER_SELECT, accessKeyHash: true },
    }),
  );
  const keyMatches =
    typeof access.accessKey === "string" &&
    KEY.test(access.accessKey) &&
    row?.accessKeyHash === hash(access.accessKey);
  const ownerMatches = !!access.customerId && row?.customerId === access.customerId;
  if (!row || !(keyMatches || ownerMatches)) throw new NotFoundError("order");
  const { accessKeyHash: _hash, ...order } = row;
  return toView(order);
}

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatusValue;
  email: string;
  totalAmount: number;
  currency: string;
  itemCount: number;
  placedAt: Date;
}

const SUMMARY_SELECT = {
  id: true,
  number: true,
  status: true,
  email: true,
  totalAmount: true,
  currency: true,
  placedAt: true,
  items: { select: { quantity: true } },
} as const;

const toSummary = (
  row: Prisma.OrderGetPayload<{ select: typeof SUMMARY_SELECT }>,
): OrderSummary => ({
  id: row.id,
  number: row.number,
  status: row.status,
  email: row.email,
  totalAmount: row.totalAmount,
  currency: row.currency,
  itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
  placedAt: row.placedAt,
});

/** A signed-in customer's own orders, newest first. */
export async function listCustomerOrders(
  db: TenantDb,
  customerId: string,
): Promise<OrderSummary[]> {
  if (!UUID.test(customerId)) return [];
  const rows = await db.run((tx) =>
    tx.order.findMany({
      where: { customerId },
      select: SUMMARY_SELECT,
      orderBy: { placedAt: "desc" },
      take: 100,
    }),
  );
  return rows.map(toSummary);
}

// --- Expiry --------------------------------------------------------------------

async function cancelIn(
  tx: AppTransaction,
  tenantId: string,
  orderId: string,
  actor: { type: string; userId?: string | null; note?: string | null },
) {
  const before = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!before || (before.status !== "pending_payment" && before.status !== "confirmed")) {
    return false;
  }
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: before.status },
    data: { status: "cancelled" },
  });
  if (updated.count === 0) return false;
  await tx.payment.updateMany({
    where: { orderId, status: "pending" },
    data: { status: "cancelled" },
  });
  await settleReservationsIn(
    tx,
    tenantId,
    { referenceType: "order", referenceId: orderId },
    "release",
  );
  await tx.orderEvent.create({
    data: {
      tenantId,
      orderId,
      type: "cancelled",
      fromStatus: before.status,
      toStatus: "cancelled",
      actorType: actor.type,
      actorUserId: actor.userId ?? null,
      note: actor.note ?? null,
    },
  });
  return true;
}

/** Cancels unpaid orders whose time to pay ran out and gives their stock back. Run by the worker. */
export async function expireUnpaidOrders(db: TenantDb, now = new Date()): Promise<number> {
  return db.run(async (tx) => {
    const expired = await tx.order.findMany({
      where: { status: "pending_payment", payBy: { lt: now } },
      select: { id: true },
      take: 500,
    });
    let cancelled = 0;
    for (const order of expired) {
      if (
        await cancelIn(tx, db.tenantId, order.id, {
          type: "system",
          note: "Not paid in time.",
        })
      ) {
        cancelled += 1;
      }
    }
    return cancelled;
  });
}

// --- Staff ---------------------------------------------------------------------

export async function listOrders(
  db: TenantDb,
  context: RequestContext,
  input: { status?: OrderStatusValue; search?: string; page?: number } = {},
): Promise<{ items: OrderSummary[]; total: number; page: number; pageCount: number }> {
  assertPermission(context, "orders.read");
  const search = (input.search ?? "").trim().replace(/^#/, "").slice(0, 100);
  const page = Number.isInteger(input.page) ? Math.min(10_000, Math.max(1, input.page!)) : 1;
  const where = {
    ...(input.status && ORDER_STATUSES.includes(input.status) ? { status: input.status } : {}),
    ...(search
      ? /^\d{1,9}$/.test(search)
        ? { number: Number(search) }
        : { email: { contains: search.toLowerCase() } }
      : {}),
  };
  const { rows, total } = await db.run(async (tx) => ({
    total: await tx.order.count({ where }),
    rows: await tx.order.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
    }),
  }));
  return {
    items: rows.map(toSummary),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE)),
  };
}

export async function getOrderForStaff(
  db: TenantDb,
  context: RequestContext,
  orderId: string,
): Promise<StaffOrderView> {
  assertPermission(context, "orders.read");
  assertOrderId(orderId);
  const row = await db.run((tx) =>
    tx.order.findUnique({
      where: { id: orderId },
      select: {
        ...ORDER_SELECT,
        events: {
          select: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            actorType: true,
            actorUserId: true,
            note: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  );
  if (!row) throw new NotFoundError("order");
  const { events, ...order } = row;
  return {
    ...toView(order),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorType: event.actorType,
      actorName: null,
      note: event.note,
      createdAt: event.createdAt,
    })),
  };
}

/**
 * Marks an order as sent: a paid online order, or a confirmed cash-on-delivery
 * order (its held stock leaves the shelf now).
 */
export async function fulfilOrder(
  db: TenantDb,
  context: RequestContext,
  orderId: string,
  note?: unknown,
): Promise<void> {
  assertPermission(context, "orders.manage");
  assertOrderId(orderId);
  const text = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
  await db.run(async (tx) => {
    const before = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!before) throw new NotFoundError("order");
    if (before.status !== "paid" && before.status !== "confirmed") {
      throw new OrderError(
        "not_allowed",
        "Only a paid order, or a confirmed cash-on-delivery order, can be marked as sent.",
      );
    }
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: before.status },
      data: { status: "fulfilled" },
    });
    if (updated.count === 0) {
      throw new OrderError("not_allowed", "This order changed meanwhile. Reload and try again.");
    }
    if (before.status === "confirmed") {
      await settleReservationsIn(
        tx,
        db.tenantId,
        { referenceType: "order", referenceId: orderId },
        "commit",
      );
    }
    await tx.orderEvent.create({
      data: {
        tenantId: db.tenantId,
        orderId,
        type: "fulfilled",
        fromStatus: before.status,
        toStatus: "fulfilled",
        actorType: "staff",
        actorUserId: context.userId,
        note: text,
      },
    });
    await audit(tx, context, "orders.fulfilled", { type: "order", id: orderId });
  });
}

/**
 * Cancels an order that has not been paid (or a cash-on-delivery order not
 * yet sent), giving its stock back. A paid order needs a refund first.
 */
export async function cancelUnpaidOrder(
  db: TenantDb,
  context: RequestContext,
  orderId: string,
): Promise<void> {
  assertPermission(context, "orders.manage");
  assertOrderId(orderId);
  await db.run(async (tx) => {
    const cancelled = await cancelIn(tx, db.tenantId, orderId, {
      type: "staff",
      userId: context.userId,
    });
    if (!cancelled) {
      if (!(await tx.order.findUnique({ where: { id: orderId } })))
        throw new NotFoundError("order");
      throw new OrderError(
        "not_allowed",
        "Only an order that has not been paid or sent can be cancelled here. A paid order needs a refund.",
      );
    }
    await audit(tx, context, "orders.cancelled", { type: "order", id: orderId });
  });
}

// --- Email ---------------------------------------------------------------------

/** The confirmation sent when an order is paid. */
export function orderConfirmationEmail(
  order: OrderView,
  store: { name: string; url: string },
  orderUrl: string,
): EmailMessage {
  const money = (amount: number) => formatMoney(amount, order.currency);
  const lines = order.items.map((item) => {
    const options = [item.color, item.size].filter(Boolean).join(", ");
    return `${item.quantity} x ${item.productName}${options ? ` (${options})` : ""}: ${money(item.lineTotalAmount)}`;
  });
  return {
    to: order.email,
    subject: `Order #${order.number} confirmed: ${store.name}`,
    text: [
      order.paymentMethod === "cash_on_delivery"
        ? `Thank you for your order. You pay in cash when it arrives.`
        : `Thank you for your order. We have received your payment.`,
      "",
      `Order #${order.number}`,
      ...lines,
      "",
      order.paymentMethod === "cash_on_delivery"
        ? `To pay the courier in cash: ${money(order.totalAmount)}`
        : `Total paid: ${money(order.totalAmount)}`,
      "",
      "Delivering to:",
      ...formatAddress(order.shippingAddress),
      "",
      `See your order: ${orderUrl}`,
      "",
      store.name,
      store.url,
    ].join("\n"),
  };
}

// --- For the mock provider's payment page ---------------------------------------

/**
 * What a payment page shows: how much, for which order. Looked up inside the
 * store by the provider's reference (which only the shopper's browser holds).
 */
export async function getPaymentForPayPage(
  db: TenantDb,
  providerPaymentId: string,
): Promise<{ amount: number; currency: string; status: string; orderNumber: number } | null> {
  if (typeof providerPaymentId !== "string" || providerPaymentId.length > 200) return null;
  const payment = await db.run((tx) =>
    tx.payment.findUnique({
      where: { providerPaymentId },
      select: { amount: true, currency: true, status: true, order: { select: { number: true } } },
    }),
  );
  return payment
    ? {
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        orderNumber: payment.order.number,
      }
    : null;
}

// --- Cash on delivery: after sending ------------------------------------------------

async function sentCashOrder(tx: AppTransaction, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      paymentMethod: true,
      totalAmount: true,
      currency: true,
      payments: { where: { status: "succeeded" }, select: { id: true } },
    },
  });
  if (!order) throw new NotFoundError("order");
  if (order.paymentMethod !== "cash_on_delivery" || order.status !== "fulfilled") {
    throw new OrderError(
      "not_allowed",
      "This applies only to a cash-on-delivery order that has been sent.",
    );
  }
  if (order.payments.length > 0) {
    throw new OrderError("not_allowed", "The cash for this order has already been recorded.");
  }
  return order;
}

/** Records that the courier collected the cash. The order then counts as paid. */
export async function recordCashCollected(
  db: TenantDb,
  context: RequestContext,
  orderId: string,
): Promise<void> {
  assertPermission(context, "orders.manage");
  assertOrderId(orderId);
  await db.run(async (tx) => {
    const order = await sentCashOrder(tx, orderId);
    await tx.payment.create({
      data: {
        tenantId: db.tenantId,
        orderId,
        provider: "cash_on_delivery",
        // One cash payment per order; the unique column makes a second impossible.
        providerPaymentId: `cod_${orderId}`,
        status: "succeeded",
        amount: order.totalAmount,
        currency: order.currency,
        methodBrand: "Cash",
      },
    });
    await tx.order.update({ where: { id: orderId }, data: { paidAt: new Date() } });
    await tx.orderEvent.create({
      data: {
        tenantId: db.tenantId,
        orderId,
        type: "cash_collected",
        actorType: "staff",
        actorUserId: context.userId,
      },
    });
    await audit(tx, context, "orders.cash_collected", { type: "order", id: orderId });
  });
}

/**
 * The parcel came back unpaid (refused, or nobody there): the order is
 * cancelled and its items go back on the shelf.
 */
export async function recordDeliveryRefused(
  db: TenantDb,
  context: RequestContext,
  orderId: string,
  note?: unknown,
): Promise<void> {
  assertPermission(context, "orders.manage");
  assertOrderId(orderId);
  const text = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
  await db.run(async (tx) => {
    await sentCashOrder(tx, orderId);
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "fulfilled" },
      data: { status: "cancelled" },
    });
    if (updated.count === 0) {
      throw new OrderError("not_allowed", "This order changed meanwhile. Reload and try again.");
    }
    await returnCommittedIn(tx, db.tenantId, "order", orderId, context.userId);
    await tx.orderEvent.create({
      data: {
        tenantId: db.tenantId,
        orderId,
        type: "delivery_refused",
        fromStatus: "fulfilled",
        toStatus: "cancelled",
        actorType: "staff",
        actorUserId: context.userId,
        note: text,
      },
    });
    await audit(tx, context, "orders.delivery_refused", { type: "order", id: orderId });
  });
}
