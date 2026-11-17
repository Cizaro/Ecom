"use server";

import { getEnv } from "@ecom/config";
import {
  checkDiscountCode,
  createAddress,
  CustomerError,
  describeDiscount,
  DiscountError,
  getCart,
  getCheckoutOptions,
  normalizeCode,
  getOrderForShopper,
  NotFoundError,
  OrderError,
  placeOrder,
  startPayment,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { tooManyCartChanges } from "@/server/cart";
import { cartOwner, getCurrentCustomer, safeReturnPath } from "@/server/customer";
import { deliverPaymentNotification, getMockProvider, getPaymentProvider } from "@/server/payments";
import { sendWaitingEmails } from "@/server/notifications";
import { shopT } from "@/server/i18n";
import { storefrontDb } from "@/server/storefront";
import { summaryPricing, type SummaryPricing } from "@/server/checkout-pricing";
import type { AccountFormState } from "../account/actions";

// Checkout actions for shoppers. The store comes from the host name
// (storefrontDb), the cart from the shopper's own session or cookie, and the
// customer (if any) from their session. The form supplies only contact and
// address details and the delivery area picked from the store's list; every
// amount is worked out on the server. Next.js rejects
// cross-site POSTs to server actions, which is the CSRF protection here.

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const ADDRESS_FIELDS = [
  "fullName",
  "phone",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "country",
] as const;

/** Where the shopper lands after paying: their account, or the guest's keyed link. */
const returnPathFor = (orderId: string, accessKey: string | null) =>
  accessKey
    ? `/order/${orderId}?key=${encodeURIComponent(accessKey)}`
    : `/account/orders/${orderId}`;

export async function placeOrderAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const [{ store, db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const values = Object.fromEntries(
    [
      ...ADDRESS_FIELDS,
      "email",
      "saveAddress",
      "paymentMethod",
      "shippingZoneId",
      "discountCode",
    ].map((name) => [name, text(formData, name)]),
  );
  if (await tooManyCartChanges(store.tenantId)) {
    return { error: t("Too many attempts in a short time. Please wait a minute."), values };
  }
  const customer = await getCurrentCustomer();
  const address = {
    fullName: text(formData, "fullName"),
    phone: text(formData, "phone"),
    line1: text(formData, "line1"),
    line2: text(formData, "line2"),
    city: text(formData, "city"),
    region: text(formData, "region"),
    postalCode: text(formData, "postalCode"),
    country: text(formData, "country"),
  };
  const expected = Number(text(formData, "expectedTotal"));
  const provider = getPaymentProvider();
  const paymentMethod =
    text(formData, "paymentMethod") === "online" ? "online" : "cash_on_delivery";
  if (paymentMethod === "online" && !provider) {
    return { error: t("Paying online is not available. Choose cash on delivery."), values };
  }

  let next: string;
  try {
    const placed = await placeOrder(db, {
      owner: await cartOwner(),
      customer: customer ? { id: customer.id, email: customer.email } : null,
      email: text(formData, "email"),
      address,
      expectedTotal: Number.isInteger(expected) ? expected : undefined,
      accessSecret: getEnv().ENCRYPTION_KEY,
      paymentMethod,
      shippingZoneId: text(formData, "shippingZoneId"),
      pricingVersion: text(formData, "pricingVersion") || undefined,
      discountCode: text(formData, "discountCode"),
      locale: t.locale,
    });
    if (customer && formData.get("saveAddress") === "on") {
      // Saving is a convenience: a full address book does not stop the order.
      await createAddress(db, customer.id, address).catch((error: unknown) => {
        if (!(error instanceof CustomerError)) throw error;
      });
    }
    const returnPath = returnPathFor(placed.orderId, customer ? null : placed.accessKey);
    if (placed.order) {
      // Cash on delivery: nothing to pay now. Send the confirmation (saved
      // with the order) and show the order.
      await sendWaitingEmails(db);
      next = returnPath;
    } else {
      ({ payUrl: next } = await startPayment(db, provider!, placed.orderId, returnPath));
    }
  } catch (error) {
    if (error instanceof OrderError) return { error: t.message(error.message), values };
    throw error;
  }
  revalidatePath("/", "layout");
  redirect(next);
}

/** Pays again for an order that is still waiting (after a decline, or a closed page). */
export async function retryPaymentAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const [{ db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const customer = await getCurrentCustomer();
  const orderId = text(formData, "orderId");
  const accessKey = text(formData, "key") || null;
  let payUrl: string;
  try {
    // Only someone who may see the order may pay for it.
    const order = await getOrderForShopper(db, orderId, {
      customerId: customer?.id ?? null,
      accessKey,
    });
    const provider = getPaymentProvider();
    if (!provider) return { error: t("Paying online is not available.") };
    ({ payUrl } = await startPayment(
      db,
      provider,
      order.id,
      returnPathFor(order.id, order.customerId ? null : accessKey),
    ));
  } catch (error) {
    if (error instanceof OrderError) return { error: t.message(error.message) };
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  redirect(payUrl);
}

/**
 * The mock provider's "pay" and "decline" buttons. They produce the signed
 * notification a real provider would send and deliver it along the same path
 * as the webhook, so nothing here can mark an order paid any other way.
 */
export async function mockPayAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  // Only for this store's payments: the lookup below runs inside its tenant.
  const { db } = await storefrontDb();
  const providerPaymentId = text(formData, "payment");
  const outcome = text(formData, "outcome") === "decline" ? "decline" : "succeed";
  const payment = await db.run((tx) =>
    tx.payment.findUnique({
      where: { providerPaymentId },
      select: { amount: true, currency: true, status: true },
    }),
  );
  if (!payment) notFound();
  if (payment.status !== "pending") {
    return { error: (await shopT())("This payment has already been completed or replaced.") };
  }
  const { body, headers } = getMockProvider().notificationFor({
    outcome,
    providerPaymentId,
    amount: payment.amount,
    currency: payment.currency,
  });
  await deliverPaymentNotification(body, headers);
  // A paid order closes the cart: every page header shows the new count.
  revalidatePath("/", "layout");
  redirect(safeReturnPath(text(formData, "return"), "/"));
}

/**
 * Checks a discount code against the shopper's own cart and returns the
 * summary's figures with it (or without it, when it does not apply). Nothing
 * is held: the code is checked again, and locked, when the order is placed.
 */
export async function previewDiscountAction(
  code: string,
): Promise<{ ok: boolean; message: string; pricing?: SummaryPricing }> {
  const [{ store, db }, t] = await Promise.all([storefrontDb(), shopT()]);
  if (await tooManyCartChanges(store.tenantId)) {
    return { ok: false, message: t("Too many attempts in a short time. Please wait a minute.") };
  }
  const [cart, options] = await Promise.all([
    cartOwner().then((owner) => getCart(db, owner)),
    getCheckoutOptions(db),
  ]);
  const currency = cart.currency ?? "USD";
  const typed = normalizeCode(typeof code === "string" ? code : "");
  const without = summaryPricing(cart.subtotalAmount, currency, options, null, t);
  if (!typed) return { ok: true, message: "", pricing: without };
  try {
    const applied = await checkDiscountCode(db, {
      code: typed,
      subtotalAmount: cart.subtotalAmount,
      currency,
    });
    return {
      ok: true,
      message: t("{code}: {discount} applied.", {
        code: applied.code,
        discount: t.message(describeDiscount({ ...applied, currency })),
      }),
      pricing: summaryPricing(cart.subtotalAmount, currency, options, applied, t),
    };
  } catch (error) {
    if (error instanceof DiscountError)
      return { ok: false, message: t.message(error.message), pricing: without };
    throw error;
  }
}
