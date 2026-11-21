"use server";

import { getEnv } from "@ecom/config";
import {
  PLAN_FEATURES,
  createInvoice,
  markInvoicePaid,
  PlatformError,
  savePaymentInstructions,
  savePlan,
  setShopPlan,
  voidInvoice,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/server/access";
import { getRequestInfo } from "@/server/auth";
import type { FormState } from "../../actions";

// Plans and payments in the platform panel (D122). Platform administrators
// only; every change is in the audit log.

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const PLAN_FIELDS = [
  "id",
  "key",
  "name",
  "description",
  "price",
  "currency",
  "productLimit",
  "staffLimit",
  "aiBudget",
  "isPublic",
  "sortOrder",
] as const;

async function actorOf(session: { user: { id: string } }) {
  const { ip } = await getRequestInfo();
  return { userId: session.user.id, ip };
}

function refresh(tenantId?: string) {
  revalidatePath("/admin/platform/billing");
  revalidatePath("/admin/platform/plans");
  if (tenantId) revalidatePath(`/admin/platform/shops/${tenantId}`);
}

export async function savePlanAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const by = await actorOf(await requirePlatformAdmin());
  const values: Record<string, string> = Object.fromEntries(
    PLAN_FIELDS.map((n) => [n, field(formData, n)]),
  );
  for (const feature of PLAN_FEATURES)
    values[`feature_${feature}`] = field(formData, `feature_${feature}`);
  const features = PLAN_FEATURES.filter((f) => values[`feature_${f}`] === "on");
  try {
    await savePlan(getEnv().DATABASE_ADMIN_URL, by, {
      ...(values as Record<(typeof PLAN_FIELDS)[number], string>),
      features,
    });
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message, values };
    throw error;
  }
  refresh();
  redirect("/admin/platform/plans?saved=1");
}

export async function savePaymentInstructionsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const by = await actorOf(await requirePlatformAdmin());
  const value = field(formData, "paymentInstructions");
  try {
    await savePaymentInstructions(getEnv().DATABASE_ADMIN_URL, by, value);
  } catch (error) {
    if (error instanceof PlatformError) {
      return { error: error.message, values: { paymentInstructions: value } };
    }
    throw error;
  }
  refresh();
  return { notice: "Saved. Shop owners see this on their billing page." };
}

export async function setShopPlanAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const by = await actorOf(await requirePlatformAdmin());
  const tenantId = field(formData, "tenantId");
  try {
    await setShopPlan(getEnv().DATABASE_ADMIN_URL, by, tenantId, field(formData, "plan"));
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message };
    throw error;
  }
  refresh(tenantId);
  return { notice: "Plan changed." };
}

export async function createInvoiceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const by = await actorOf(await requirePlatformAdmin());
  const tenantId = field(formData, "tenantId");
  try {
    const invoice = await createInvoice(getEnv().DATABASE_ADMIN_URL, by, tenantId, {
      months: field(formData, "months"),
    });
    refresh(tenantId);
    return { notice: `Invoice ${invoice.number} created. The shop sees it on its billing page.` };
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message };
    throw error;
  }
}

export async function markInvoicePaidAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const by = await actorOf(await requirePlatformAdmin());
  try {
    await markInvoicePaid(getEnv().DATABASE_ADMIN_URL, by, field(formData, "invoiceId"), {
      method: field(formData, "method"),
      reference: field(formData, "reference"),
    });
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message };
    throw error;
  }
  refresh(field(formData, "tenantId") || undefined);
  return { notice: "Payment recorded." };
}

export async function voidInvoiceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const by = await actorOf(await requirePlatformAdmin());
  try {
    await voidInvoice(getEnv().DATABASE_ADMIN_URL, by, field(formData, "invoiceId"));
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message };
    throw error;
  }
  refresh(field(formData, "tenantId") || undefined);
  return { notice: "Invoice cancelled." };
}
