"use server";

import { addToCart, CartError, setCartItemQuantity } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { readCartToken, tooManyCartChanges, writeCartToken } from "@/server/cart";
import { storefrontDb } from "@/server/storefront";

// Cart actions for visitors. No sign-in: the store comes from the host name
// (storefrontDb) and the cart from the visitor's own cookie token. The form
// supplies only which variant or line and how many; prices are read from the
// catalog by the cart service. Next.js rejects cross-site POSTs to server
// actions, which is the CSRF protection for these forms.

export interface CartFormState {
  error?: string;
  notice?: string;
}

const TOO_MANY = "Too many changes in a short time. Please wait a minute and try again.";

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** A whole number from a form field, or NaN (which the cart service refuses). */
const wholeNumber = (formData: FormData, name: string): number => {
  const value = text(formData, name).trim();
  return /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
};

async function attempt(work: () => Promise<CartFormState>): Promise<CartFormState> {
  try {
    const state = await work();
    // The header's cart count is part of every storefront page.
    revalidatePath("/", "layout");
    return state;
  } catch (error) {
    if (error instanceof CartError) return { error: error.message };
    throw error;
  }
}

export async function addToCartAction(
  _previous: CartFormState,
  formData: FormData,
): Promise<CartFormState> {
  const { store, db } = await storefrontDb();
  if (await tooManyCartChanges(store.tenantId)) return { error: TOO_MANY };
  return attempt(async () => {
    const result = await addToCart(db, await readCartToken(), {
      variantId: text(formData, "variantId"),
      quantity: wholeNumber(formData, "quantity"),
    });
    if (result.tokenIsNew) await writeCartToken(result.token);
    return {
      notice: result.capped
        ? "Added. You now have the most allowed of this item in your cart."
        : "Added to your cart.",
    };
  });
}

export async function updateCartItemAction(
  _previous: CartFormState,
  formData: FormData,
): Promise<CartFormState> {
  const { store, db } = await storefrontDb();
  if (await tooManyCartChanges(store.tenantId)) return { error: TOO_MANY };
  return attempt(async () => {
    await setCartItemQuantity(
      db,
      await readCartToken(),
      text(formData, "itemId"),
      wholeNumber(formData, "quantity"),
    );
    return {};
  });
}

export async function removeCartItemAction(
  _previous: CartFormState,
  formData: FormData,
): Promise<CartFormState> {
  const { store, db } = await storefrontDb();
  if (await tooManyCartChanges(store.tenantId)) return { error: TOO_MANY };
  return attempt(async () => {
    await setCartItemQuantity(db, await readCartToken(), text(formData, "itemId"), 0);
    return {};
  });
}
