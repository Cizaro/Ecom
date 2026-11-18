import { getEnv } from "@ecom/config";
import {
  getCart,
  getCheckoutOptions,
  listAddresses,
  PAY_WITHIN_MINUTES,
  priceOrder,
  productNamesBySlug,
} from "@ecom/core";
import { Alert, buttonClasses, Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cartOwner, getCurrentCustomer } from "@/server/customer";
import { shopT } from "@/server/i18n";
import { trackShopEvent } from "@/server/analytics";
import { storefrontDb } from "@/server/storefront";
import {
  AccountCheckbox,
  AccountField,
  AccountForm,
  AccountSelect,
} from "../_components/account-form";
import { AddressFields } from "../_components/address-fields";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { placeOrderAction } from "./actions";
import { CheckoutAmounts } from "./checkout-amounts";
import { DiscountField } from "./discount-field";
import { summaryPricing } from "@/server/checkout-pricing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Checkout"), robots: { index: false, follow: false } };
}

// One page: who you are, where it goes (and which delivery area), what it costs. Every amount shown
// here is worked out on the server again when the order is placed; if it
// changed in between, the order is not placed and the shopper is told.
export default async function CheckoutPage() {
  const [{ db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const [cart, customer, options] = await Promise.all([
    cartOwner().then((owner) => getCart(db, owner)),
    getCurrentCustomer(),
    getCheckoutOptions(db),
  ]);
  if (cart.lines.length === 0) redirect("/cart");
  await trackShopEvent(db, { name: "checkout_started" });
  const currency = cart.currency ?? "USD";
  const blocked = cart.lines.some((line) => !line.available || line.onlyLeft !== null);
  const saved = customer ? await listAddresses(db, customer.id) : [];
  const names = await productNamesBySlug(
    db,
    t.locale,
    cart.lines.map((line) => line.productSlug),
  );
  const defaultAddress = saved.find((address) => address.isDefaultShipping);
  // Cash on delivery is always offered; paying online only when a provider is set up.
  const online = getEnv().PAYMENT_PROVIDER === "none" ? null : getEnv().PAYMENT_PROVIDER;
  // Delivery areas the store offers, each with its price for this cart.
  const zones = options.zones.filter((zone) => zone.currency === currency);
  const hasZones = options.zones.length > 0;
  const { byZone, fallback } = summaryPricing(cart.subtotalAmount, currency, options, null, t);
  const zoneOptions = zones.map((zone) => {
    const fee = priceOrder(cart.subtotalAmount, zone, {
      ...options.tax,
      rateBasisPoints: 0,
    }).shippingAmount;
    return {
      value: zone.id,
      label: `${zone.name}: ${fee === 0 ? t("free delivery") : t.money(fee, currency)}`,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        trail={[
          { name: t("Home"), href: "/" },
          { name: t("Cart"), href: "/cart" },
        ]}
        current={t("Checkout")}
      />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Checkout")}</h1>

      {blocked ? (
        <Alert tone="error" testId="checkout-blocked">
          {t("Something in your cart is no longer available in that quantity.")}{" "}
          <Link href="/cart" className="underline underline-offset-4">
            {t("Review your cart before checking out.")}
          </Link>
        </Alert>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <AccountForm
            action={placeOrderAction}
            submitLabel={t("Place order")}
            testId="checkout-form"
          >
            <input type="hidden" name="expectedTotal" value={cart.subtotalAmount} />
            <input type="hidden" name="pricingVersion" value={options.version} />
            <Card title={t("Contact")}>
              {customer ? (
                <p className="text-sm" data-testid="checkout-email">
                  {t("Signed in as {email}. Your order will appear in your account.", {
                    email: customer.email,
                  })}
                </p>
              ) : (
                <>
                  <AccountField
                    label={t("Email")}
                    name="email"
                    type="email"
                    autoComplete="email"
                    hint={t("For your order confirmation.")}
                    required
                  />
                  <p className="text-sm text-ink-muted">
                    {t("Have an account?")}{" "}
                    <Link
                      href="/account/sign-in?next=%2Fcheckout"
                      className="text-ink underline underline-offset-4"
                    >
                      {t("Sign in first")}
                    </Link>
                    {t(", or check out as a guest.")}
                  </p>
                </>
              )}
            </Card>
            <Card title={t("Delivery address")}>
              <AddressFields address={defaultAddress} />
              {hasZones ? (
                <AccountSelect
                  label={t("Delivery area")}
                  name="shippingZoneId"
                  hint={t("The delivery price is added to your total.")}
                  required
                  defaultValue={zones.length === 1 ? zones[0]!.id : ""}
                  options={[{ value: "", label: t("Choose your delivery area") }, ...zoneOptions]}
                />
              ) : null}
              {customer ? (
                <AccountCheckbox label={t("Save this address to my account")} name="saveAddress" />
              ) : null}
            </Card>
            <Card title={t("Discount code")}>
              <DiscountField />
            </Card>
            <Card title={t("Payment")}>
              <fieldset className="flex flex-col gap-3" data-testid="payment-methods">
                <legend className="sr-only">{t("How will you pay?")}</legend>
                <label className="flex items-start gap-3 rounded-control border border-line p-3">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="cash_on_delivery"
                    defaultChecked
                    className="mt-1 size-5 accent-brand"
                  />
                  <span>
                    <span className="font-medium">{t("Cash on delivery")}</span>
                    <span className="block text-sm text-ink-muted">
                      {t(
                        "Pay the courier in cash when your order arrives. Add a phone number above so the courier can reach you.",
                      )}
                    </span>
                  </span>
                </label>
                {online ? (
                  <label className="flex items-start gap-3 rounded-control border border-line p-3">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="online"
                      className="mt-1 size-5 accent-brand"
                    />
                    <span>
                      <span className="font-medium">
                        {t("Pay online by card")}
                        {online === "mock" ? ` ${t("(test mode, no money moves)")}` : ""}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        {t("Your items are held for {minutes} minutes while you pay.", {
                          minutes: PAY_WITHIN_MINUTES,
                        })}
                      </span>
                    </span>
                  </label>
                ) : null}
              </fieldset>
            </Card>
          </AccountForm>

          <section
            aria-labelledby="checkout-summary"
            className="flex h-fit flex-col gap-4 rounded-card border border-line p-5"
            data-testid="checkout-summary"
          >
            <h2 id="checkout-summary" className="text-lg font-semibold">
              {t("Your order")}
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              {cart.lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {line.quantity} × {names.get(line.productSlug) ?? line.productName}
                    {line.color || line.size ? (
                      <span className="text-ink-muted">
                        {" "}
                        ({[line.color, line.size].filter(Boolean).join(", ")})
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0">{t.money(line.lineTotalAmount, currency)}</span>
                </li>
              ))}
            </ul>
            <CheckoutAmounts selectId="shippingZoneId" byZone={byZone} fallback={fallback} />
            <Link href="/cart" className={buttonClasses("secondary")}>
              {t("Edit cart")}
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}
