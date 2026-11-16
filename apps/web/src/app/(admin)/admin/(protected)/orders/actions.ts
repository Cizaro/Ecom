"use server";

import {
  cancelUnpaidOrder,
  recordCashCollected,
  recordDeliveryRefused,
  ForbiddenError,
  fulfilOrder,
  NotFoundError,
  OrderError,
  recordReturn,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import { sendWaitingEmails } from "@/server/notifications";
import type { FormState } from "../../actions";

// Order changes by staff. Each action checks orders.manage itself; the
// services check it again, keep to the allowed status steps and write the
// order history and the audit log.

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function attempt(
  work: () => Promise<FormState>,
  values?: Record<string, string>,
): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function fulfilOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("orders.manage");
  const id = field(formData, "id");
  return attempt(async () => {
    await fulfilOrder(tenantDb(context), context, id, {
      note: field(formData, "note"),
      courier: field(formData, "courier"),
      trackingReference: field(formData, "trackingReference"),
      trackingUrl: field(formData, "trackingUrl"),
    });
    await sendWaitingEmails(tenantDb(context));
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { notice: "Marked as sent." };
  });
}

export async function cancelOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("orders.manage");
  const id = field(formData, "id");
  return attempt(async () => {
    await cancelUnpaidOrder(tenantDb(context), context, id);
    await sendWaitingEmails(tenantDb(context));
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { notice: "Cancelled. The items are back in stock." };
  });
}

export async function cashCollectedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("orders.manage");
  const id = field(formData, "id");
  return attempt(async () => {
    await recordCashCollected(tenantDb(context), context, id);
    await sendWaitingEmails(tenantDb(context));
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { notice: "Cash recorded. The order is paid." };
  });
}

export async function deliveryRefusedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("orders.manage");
  const id = field(formData, "id");
  return attempt(async () => {
    await recordDeliveryRefused(tenantDb(context), context, id, field(formData, "note"));
    await sendWaitingEmails(tenantDb(context));
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { notice: "Recorded. The order is cancelled and the items are back in stock." };
  });
}

/**
 * Records items a customer gave back. The form has one quantity and one
 * condition per order line ("qty-<line id>", "condition-<line id>"); the
 * service checks the lines belong to this order.
 */
export async function recordReturnAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("returns.manage");
  const id = field(formData, "id");
  const items = [...formData.keys()]
    .filter((key) => key.startsWith("qty-"))
    .map((key) => {
      const orderItemId = key.slice("qty-".length);
      return {
        orderItemId,
        quantity: field(formData, key),
        condition: field(formData, `condition-${orderItemId}`),
      };
    });
  const values: Record<string, string> = {
    reason: field(formData, "reason"),
    note: field(formData, "note"),
    refund: field(formData, "refund"),
    refundMethod: field(formData, "refundMethod"),
    ...Object.fromEntries(items.map((item) => [`qty-${item.orderItemId}`, item.quantity])),
  };
  return attempt(async () => {
    const db = tenantDb(context);
    await recordReturn(db, context, {
      orderId: id,
      items,
      reason: values.reason,
      note: values.note,
      refund: values.refund,
      refundMethod: values.refundMethod,
    });
    await sendWaitingEmails(db);
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { notice: "Return recorded." };
  }, values);
}
