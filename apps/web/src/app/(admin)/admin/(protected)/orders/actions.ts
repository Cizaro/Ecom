"use server";

import {
  cancelUnpaidOrder,
  ForbiddenError,
  fulfilOrder,
  NotFoundError,
  OrderError,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Order changes by staff. Each action checks orders.manage itself; the
// services check it again, keep to the allowed status steps and write the
// order history and the audit log.

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function attempt(work: () => Promise<FormState>): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
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
    await fulfilOrder(tenantDb(context), context, id, field(formData, "note"));
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
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { notice: "Cancelled. The items are back in stock." };
  });
}
