"use server";

import {
  createShippingZone,
  deleteShippingZone,
  ForbiddenError,
  NotFoundError,
  saveTaxSettings,
  ShippingError,
  updateShippingZone,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Store settings: delivery areas and tax. Every action checks settings.write
// itself; the services check it again, run inside the staff member's tenant
// and write the audit log.

const PAGE = "/admin/settings/shipping";

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
    if (error instanceof ShippingError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const zoneValues = (formData: FormData) => ({
  name: field(formData, "name"),
  countries: field(formData, "countries"),
  rate: field(formData, "rate"),
  freeOver: field(formData, "freeOver"),
  position: field(formData, "position"),
  isActive: field(formData, "isActive"),
});

const refresh = () => {
  revalidatePath(PAGE);
  revalidatePath("/checkout");
};

export async function createShippingZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("settings.write");
  const values = zoneValues(formData);
  return attempt(async () => {
    await createShippingZone(tenantDb(context), context, {
      ...values,
      isActive: values.isActive === "on",
    });
    refresh();
    return { notice: "Delivery area added." };
  }, values);
}

export async function updateShippingZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("settings.write");
  const values = zoneValues(formData);
  return attempt(async () => {
    await updateShippingZone(tenantDb(context), context, field(formData, "id"), {
      ...values,
      isActive: values.isActive === "on",
    });
    refresh();
    return { notice: "Saved." };
  }, values);
}

export async function deleteShippingZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("settings.write");
  return attempt(async () => {
    await deleteShippingZone(tenantDb(context), context, field(formData, "id"));
    refresh();
    return { notice: "Delivery area deleted." };
  });
}

export async function saveTaxSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("settings.write");
  const values = {
    rate: field(formData, "rate"),
    included: field(formData, "included"),
    label: field(formData, "label"),
  };
  return attempt(async () => {
    await saveTaxSettings(tenantDb(context), context, values);
    refresh();
    return { notice: "Tax settings saved." };
  }, values);
}
