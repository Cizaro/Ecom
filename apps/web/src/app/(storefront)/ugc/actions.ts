"use server";

import { MAX_VIDEO_BYTES, NotFoundError, shareUgc, UgcError, withdrawUgc } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { tooManyAttempts } from "@/server/limits";
import { getCurrentCustomer } from "@/server/customer";
import { mediaDeps } from "@/server/media";
import { storefrontDb } from "@/server/storefront";
import type { AccountFormState } from "../account/actions";

// Customers sharing photos and videos, and taking them back. The store comes
// from the host name (storefrontDb), the customer from their own session;
// the service checks they received the product and records their permission.

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function shareUgcAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { store, db } = await storefrontDb();
  const values = {
    productId: text(formData, "productId"),
    caption: text(formData, "caption"),
    creditName: text(formData, "creditName"),
  };
  const customer = await getCurrentCustomer();
  if (!customer) return { error: "Sign in to share a photo or video.", values };
  if (await tooManyAttempts(store.tenantId, "photo")) {
    return { error: "Too many attempts in a short time. Please wait a minute.", values };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo or video to share.", values };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return { error: "The file is too large (8 MB at most).", values };
  }
  try {
    await shareUgc(db, mediaDeps(), customer, {
      ...values,
      bytes: new Uint8Array(await file.arrayBuffer()),
      permission: formData.get("permission") === "on",
      storeName: store.name,
    });
  } catch (error) {
    if (error instanceof UgcError) return { error: error.message, values };
    throw error;
  }
  revalidatePath("/account/photos");
  return { notice: "Thank you. It will appear once the store has checked it." };
}

export async function withdrawUgcAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const customer = await getCurrentCustomer();
  if (!customer) return { error: "Sign in to manage your photos." };
  try {
    await withdrawUgc(db, mediaDeps(), customer.id, text(formData, "id"));
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "That item could not be found." };
    throw error;
  }
  revalidatePath("/account/photos");
  revalidatePath("/gallery");
  revalidatePath("/p/[slug]", "page");
  return { notice: "Permission withdrawn. It has been taken down and the file deleted." };
}
