"use server";

import { getEnv } from "@ecom/config";
import { createShop, PlatformError, setShopStatus } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/server/access";
import { getAuthService, getRequestInfo } from "@/server/auth";
import type { FormState } from "../../actions";

// The platform owner's actions (D120). Platform administrators only; every
// change is in the shop's audit log as done by a platform administrator.

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const SHOP_FIELDS = [
  "name",
  "slug",
  "address",
  "ownerEmail",
  "ownerName",
  "currency",
  "timezone",
] as const;

export async function createShopAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requirePlatformAdmin();
  const values = Object.fromEntries(SHOP_FIELDS.map((n) => [n, field(formData, n)])) as Record<
    (typeof SHOP_FIELDS)[number],
    string
  >;
  const { ip } = await getRequestInfo();
  let id: string;
  try {
    const shop = await createShop(
      getEnv().DATABASE_ADMIN_URL,
      { userId: session.user.id, ip },
      values,
    );
    id = shop.id;
    // A new owner chooses their password from the email (the reset link).
    if (shop.newOwner) await getAuthService().requestPasswordReset({ email: shop.ownerEmail, ip });
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message, values };
    throw error;
  }
  revalidatePath("/admin/platform");
  redirect(`/admin/platform/shops/${id}?created=1`);
}

export async function setShopStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requirePlatformAdmin();
  const id = field(formData, "id");
  const status = field(formData, "status") === "suspended" ? "suspended" : "active";
  const { ip } = await getRequestInfo();
  try {
    await setShopStatus(
      getEnv().DATABASE_ADMIN_URL,
      { userId: session.user.id, ip },
      id,
      status,
      field(formData, "reason"),
    );
  } catch (error) {
    if (error instanceof PlatformError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/admin/platform/shops/${id}`);
  revalidatePath("/admin/platform/shops");
  return {
    notice:
      status === "suspended"
        ? "Suspended. Its website and admin are closed; nothing was deleted."
        : "Resumed. The shop is open again.",
  };
}
