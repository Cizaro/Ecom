"use server";

import { ForbiddenError, setRequireStaffTwoFactor } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Requiring two-factor sign-in for owners and managers (launch hardening).
// staff.manage here; the service also requires the owner role.
export async function setRequireTwoFactorAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("staff.manage");
  const on = formData.get("require") === "on";
  try {
    await setRequireStaffTwoFactor(tenantDb(context), context, on);
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
  revalidatePath("/admin/team");
  return {
    notice: on
      ? "Saved. Owners and managers without two-factor sign-in are asked to set it up at their next page."
      : "Saved. Two-factor sign-in is no longer required.",
  };
}
