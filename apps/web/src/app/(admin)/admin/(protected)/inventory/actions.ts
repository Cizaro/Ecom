"use server";

import {
  changeStock,
  createLocation,
  ForbiddenError,
  InventoryError,
  NotFoundError,
  setDefaultLocation,
  setTracking,
  STOCK_OPERATIONS,
  updateLocation,
  type StockOperation,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Stock changes by staff. Every action checks inventory.adjust itself; the
// services check it again, run inside the staff member's tenant, record a
// movement for every change and write the audit log.

const STOCK = "/admin/inventory";

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** A whole number typed into a form, or NaN (which the service refuses with a message). */
const wholeNumber = (formData: FormData, name: string): number => {
  const raw = field(formData, name).trim();
  return /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
};

async function attempt(
  work: () => Promise<FormState>,
  values?: Record<string, string>,
): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InventoryError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const NOTICES: Record<StockOperation, string> = {
  receive: "Stock received.",
  count: "Count saved.",
  damage: "Marked as damaged.",
  remove_damaged: "Damaged items removed.",
};

export async function changeStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inventory.adjust");
  const variantId = field(formData, "variantId");
  const requested = field(formData, "operation");
  const operation = STOCK_OPERATIONS.find((value) => value === requested);
  if (!operation) return { error: "Choose what kind of change this is." };
  return attempt(
    async () => {
      await changeStock(tenantDb(context), context, {
        variantId,
        locationId: field(formData, "locationId"),
        operation,
        quantity: wholeNumber(formData, "quantity"),
        note: field(formData, "note"),
      });
      revalidatePath(STOCK);
      revalidatePath(`${STOCK}/${variantId}`);
      return { notice: NOTICES[operation] };
    },
    {
      operation: requested,
      locationId: field(formData, "locationId"),
      quantity: field(formData, "quantity"),
      note: field(formData, "note"),
    },
  );
}

export async function setTrackingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inventory.adjust");
  const variantId = field(formData, "variantId");
  const tracked = field(formData, "tracked") === "true";
  return attempt(async () => {
    await setTracking(tenantDb(context), context, variantId, tracked);
    revalidatePath(STOCK);
    revalidatePath(`${STOCK}/${variantId}`);
    return { notice: tracked ? "Stock is now counted." : "Stock is no longer counted." };
  });
}

export async function createLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inventory.adjust");
  const values = { name: field(formData, "name"), address: field(formData, "address") };
  return attempt(async () => {
    await createLocation(tenantDb(context), context, values);
    revalidatePath(`${STOCK}/locations`);
    return { notice: "Location added." };
  }, values);
}

export async function updateLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inventory.adjust");
  const values = { name: field(formData, "name"), address: field(formData, "address") };
  return attempt(async () => {
    await updateLocation(tenantDb(context), context, field(formData, "id"), values);
    revalidatePath(`${STOCK}/locations`);
    return { notice: "Saved." };
  }, values);
}

export async function setDefaultLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inventory.adjust");
  return attempt(async () => {
    await setDefaultLocation(tenantDb(context), context, field(formData, "id"));
    revalidatePath(`${STOCK}/locations`);
    return {};
  });
}
