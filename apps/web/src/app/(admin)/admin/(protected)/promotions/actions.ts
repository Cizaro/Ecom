"use server";

import {
  createDiscountCode,
  deleteDiscountCode,
  DiscountError,
  ForbiddenError,
  NotFoundError,
  updateDiscountCode,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Discount codes. Every action checks promotions.write itself; the services
// check it again, run inside the staff member's tenant and write the audit log.

const PAGE = "/admin/promotions";

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
    if (error instanceof DiscountError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const values = (formData: FormData) => ({
  code: field(formData, "code"),
  kind: field(formData, "kind"),
  value: field(formData, "value"),
  minSubtotal: field(formData, "minSubtotal"),
  startsOn: field(formData, "startsOn"),
  endsOn: field(formData, "endsOn"),
  usageLimit: field(formData, "usageLimit"),
  perCustomerLimit: field(formData, "perCustomerLimit"),
  isActive: field(formData, "isActive"),
});

export async function createDiscountCodeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("promotions.write");
  const input = values(formData);
  return attempt(async () => {
    await createDiscountCode(tenantDb(context), context, {
      ...input,
      isActive: input.isActive === "on",
    });
    revalidatePath(PAGE);
    return { notice: "Discount code added." };
  }, input);
}

export async function updateDiscountCodeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("promotions.write");
  const input = values(formData);
  return attempt(async () => {
    await updateDiscountCode(tenantDb(context), context, field(formData, "id"), {
      ...input,
      isActive: input.isActive === "on",
    });
    revalidatePath(PAGE);
    return { notice: "Saved." };
  }, input);
}

export async function deleteDiscountCodeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("promotions.write");
  return attempt(async () => {
    await deleteDiscountCode(tenantDb(context), context, field(formData, "id"));
    revalidatePath(PAGE);
    return { notice: "Discount code deleted." };
  });
}
