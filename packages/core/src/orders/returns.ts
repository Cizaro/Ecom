import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { formatMoney, parseMoney } from "../catalog/money";
import { restockReturnedIn } from "../inventory/stock";
import { EMAIL_EVENTS, enqueueEmailIn } from "../notifications/enqueue";
import { OrderError } from "./orders";

// Returns, recorded by staff when a customer gives items back. Rules:
//
// - Only an order that was sent and paid (cash collected, or paid online) can
//   have a return. A cash parcel that came back unpaid is "Delivery refused".
// - No more of a line can come back than was bought, across all returns (the
//   database checks this too, with the line locked).
// - Money given back is recorded with the return: never more than was paid
//   less what was already given back. Recording a refund needs orders.refund;
//   recording a return needs returns.manage. Card refunds through a payment
//   provider are not built yet: this records money given back by hand.
// - Returned items go back on the shelf: resellable ones for sale, damaged
//   ones kept apart. When everything paid has been given back, the order is
//   marked refunded.

export const RETURN_REASONS = [
  "changed_mind",
  "damaged",
  "wrong_item",
  "not_as_described",
  "other",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  changed_mind: "Changed their mind",
  damaged: "Arrived damaged",
  wrong_item: "Wrong item sent",
  not_as_described: "Not as described",
  other: "Other",
};

export const REFUND_METHODS = ["cash", "bank_transfer", "other"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export type ReturnCondition = "resellable" | "damaged";

export interface ReturnInput {
  orderId: string;
  /** Quantity returned per order line; lines left out or at 0 are not returned. */
  items: { orderItemId: string; quantity: unknown; condition: unknown }[];
  reason: unknown;
  note?: unknown;
  /** Money given back, as typed ("12.50"); empty or 0 for none. */
  refund?: unknown;
  refundMethod?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Records a return. Returns its ID. */
export async function recordReturn(
  db: TenantDb,
  context: RequestContext,
  input: ReturnInput,
): Promise<{ id: string }> {
  assertPermission(context, "returns.manage");
  if (!UUID.test(input.orderId)) throw new NotFoundError("order");
  const reason = RETURN_REASONS.find((value) => value === input.reason);
  if (!reason) throw new OrderError("invalid", "Choose why the items came back.", "reason");
  const note =
    typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  const lines = input.items
    .map((item) => {
      const raw =
        typeof item.quantity === "string" ? item.quantity.trim() : String(item.quantity ?? "");
      const quantity = raw === "" ? 0 : /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
      return {
        orderItemId: item.orderItemId,
        quantity,
        condition: (item.condition === "damaged" ? "damaged" : "resellable") as ReturnCondition,
      };
    })
    .filter((line) => line.quantity !== 0);
  if (lines.some((line) => !Number.isInteger(line.quantity))) {
    throw new OrderError("invalid", "Enter how many came back as a whole number.", "items");
  }
  if (lines.length === 0) {
    throw new OrderError("invalid", "Enter how many of at least one item came back.", "items");
  }

  return db.run(async (tx) => {
    // One return or refund at a time per order.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        currency: true,
        totalAmount: true,
        refundedAmount: true,
        items: { select: { id: true, quantity: true, variantId: true, productName: true } },
        payments: { where: { status: "succeeded" }, select: { amount: true } },
      },
    });
    if (!order) throw new NotFoundError("order");
    const paid = order.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if ((order.status !== "fulfilled" && order.status !== "refunded") || paid === 0) {
      throw new OrderError(
        "not_allowed",
        order.status === "fulfilled"
          ? "This order has not been paid. For a cash parcel that came back unpaid, use Delivery refused."
          : "Only an order that was sent and paid can have a return.",
      );
    }

    // How many of each line can still come back.
    const already = await tx.orderReturnItem.groupBy({
      by: ["orderItemId"],
      where: { orderReturn: { orderId: order.id } },
      _sum: { quantity: true },
    });
    const returnedSoFar = new Map(already.map((row) => [row.orderItemId, row._sum.quantity ?? 0]));
    for (const line of lines) {
      const item = order.items.find((candidate) => candidate.id === line.orderItemId);
      if (!item) throw new OrderError("invalid", "That item is not on this order.", "items");
      const left = item.quantity - (returnedSoFar.get(item.id) ?? 0);
      if (line.quantity > left) {
        throw new OrderError(
          "invalid",
          left === 0
            ? `All of ${item.productName} has already been returned.`
            : `Only ${left} of ${item.productName} can still be returned.`,
          "items",
        );
      }
    }

    // Money given back.
    const refundText = typeof input.refund === "string" ? input.refund.trim() : "";
    const refundAmount = refundText === "" ? 0 : parseMoney(refundText, order.currency);
    if (refundAmount === null) {
      throw new OrderError(
        "invalid",
        "Enter the amount given back, such as 15.00, or leave it empty.",
        "refund",
      );
    }
    let refundMethod: RefundMethod | null = null;
    if (refundAmount > 0) {
      assertPermission(context, "orders.refund");
      const refundable = paid - order.refundedAmount;
      if (refundAmount > refundable) {
        throw new OrderError(
          "invalid",
          `At most ${formatMoney(refundable, order.currency)} can be given back on this order.`,
          "refund",
        );
      }
      refundMethod = REFUND_METHODS.find((value) => value === input.refundMethod) ?? null;
      if (!refundMethod) {
        throw new OrderError("invalid", "Choose how the money was given back.", "refundMethod");
      }
    }

    const created = await tx.orderReturn.create({
      data: {
        tenantId: db.tenantId,
        orderId: order.id,
        reason,
        note,
        refundAmount,
        refundMethod,
        createdByUserId: context.userId,
        items: {
          create: lines.map((line) => ({
            tenantId: db.tenantId,
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            condition: line.condition,
          })),
        },
      },
      select: { id: true },
    });

    for (const line of lines) {
      const item = order.items.find((candidate) => candidate.id === line.orderItemId)!;
      await restockReturnedIn(tx, db.tenantId, {
        variantId: item.variantId,
        quantity: line.quantity,
        condition: line.condition,
        orderId: order.id,
        returnId: created.id,
        actorUserId: context.userId,
      });
    }

    const refundedAmount = order.refundedAmount + refundAmount;
    const fullyRefunded =
      refundAmount > 0 && refundedAmount >= paid && order.status === "fulfilled";
    if (refundAmount > 0 || fullyRefunded) {
      await tx.order.update({
        where: { id: order.id },
        data: { refundedAmount, ...(fullyRefunded ? { status: "refunded" } : {}) },
      });
    }
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    await tx.orderEvent.create({
      data: {
        tenantId: db.tenantId,
        orderId: order.id,
        type: "returned",
        ...(fullyRefunded ? { fromStatus: "fulfilled", toStatus: "refunded" } : {}),
        actorType: "staff",
        actorUserId: context.userId,
        note: [
          `${count} ${count === 1 ? "item" : "items"} back (${RETURN_REASON_LABEL[reason]})`,
          refundAmount > 0
            ? `${formatMoney(refundAmount, order.currency)} given back by ${REFUND_METHOD_LABEL[refundMethod!].toLowerCase()}`
            : null,
          note,
        ]
          .filter(Boolean)
          .join(". "),
      },
    });
    await enqueueEmailIn(
      tx,
      db.tenantId,
      EMAIL_EVENTS.returnRecorded,
      { orderId: order.id, returnId: created.id },
      `return:${created.id}`,
    );
    await audit(tx, context, "orders.return_recorded", { type: "order", id: order.id }, undefined, {
      returnId: created.id,
      items: count,
      refundAmount,
      refundMethod,
    });
    return created;
  });
}
