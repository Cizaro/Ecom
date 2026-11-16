"use server";

import { NotFoundError, reportReview, ReviewError, submitReview } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { tooManyCartChanges } from "@/server/cart";
import { getCurrentCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import type { AccountFormState } from "../account/actions";

// Reviews from shoppers. The store comes from the host name (storefrontDb),
// the customer from their own session; the service checks they received the
// product. A review waits for staff approval before anyone sees it.

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const pagePath = (formData: FormData) => {
  const slug = text(formData, "slug");
  return /^[a-z0-9-]{1,120}$/.test(slug) ? `/p/${slug}` : "/";
};

export async function submitReviewAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { store, db } = await storefrontDb();
  const values = {
    rating: text(formData, "rating"),
    title: text(formData, "title"),
    body: text(formData, "body"),
  };
  const customer = await getCurrentCustomer();
  if (!customer) return { error: "Sign in to write a review.", values };
  if (await tooManyCartChanges(store.tenantId)) {
    return { error: "Too many attempts in a short time. Please wait a minute.", values };
  }
  try {
    await submitReview(db, customer, text(formData, "productId"), values);
  } catch (error) {
    if (error instanceof ReviewError) return { error: error.message, values };
    if (error instanceof NotFoundError) return { error: "This product is no longer available." };
    throw error;
  }
  revalidatePath(pagePath(formData));
  return { notice: "Thank you. Your review will appear once the store has checked it." };
}

export async function reportReviewAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { store, db } = await storefrontDb();
  const customer = await getCurrentCustomer();
  if (!customer) return { error: "Sign in to report a review." };
  if (await tooManyCartChanges(store.tenantId)) {
    return { error: "Too many attempts in a short time. Please wait a minute." };
  }
  try {
    await reportReview(db, customer.id, text(formData, "reviewId"), text(formData, "reason"));
  } catch (error) {
    if (error instanceof ReviewError) return { error: error.message };
    if (error instanceof NotFoundError) return { error: "This review is no longer shown." };
    throw error;
  }
  return { notice: "Thank you. The store will look at this review." };
}
