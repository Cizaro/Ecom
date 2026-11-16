import { getEnv } from "@ecom/config";
import {
  formatMoney,
  getCart,
  getCheckoutOptions,
  listAddresses,
  orderAmountLines,
  PAY_WITHIN_MINUTES,
  priceOrder,
  type ShippingZoneView,
  type TaxSettings,
} from "@ecom/core";
import { Alert, buttonClasses, Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cartOwner, getCurrentCustomer } from "@/server/customer";
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
import { CheckoutAmounts, type PricedRows } from "./checkout-amounts";

/** The summary rows for one delivery area (or none), worked out on the server. */
function pricedRows(
  subtotal: number,
  currency: string,
  zone: ShippingZoneView | null,
  tax: TaxSettings,
  hasZones: boolean,
): PricedRows {
  const pricing = priceOrder(subtotal, zone, tax);
  const rows = orderAmountLines({
    ...pricing,
    currency,
    shippingZoneName: zone?.name ?? null,
    taxRateBasisPoints: tax.rateBasisPoints,
    taxLabel: tax.label,
  });
  if (hasZones && !zone) rows.splice(1, 0, ["Delivery", "Choose your area"]);
  return { rows, total: formatMoney(pricing.totalAmount, currency) };
}

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

// One page: who you are, where it goes (and which delivery area), what it costs. Every amount shown
// here is worked out on the server again when the order is placed; if it
// changed in between, the order is not placed and the shopper is told.
export default async function CheckoutPage() {
  const { db } = await storefrontDb();
  const [cart, customer, options] = await Promise.all([
    cartOwner().then((owner) => getCart(db, owner)),
    getCurrentCustomer(),
    getCheckoutOptions(db),
  ]);
  if (cart.lines.length === 0) redirect("/cart");
  const currency = cart.currency ?? "USD";
  const blocked = cart.lines.some((line) => !line.available || line.onlyLeft !== null);
  const saved = customer ? await listAddresses(db, customer.id) : [];
  const defaultAddress = saved.find((address) => address.isDefaultShipping);
  // Cash on delivery is always offered; paying online only when a provider is set up.
  const online = getEnv().PAYMENT_PROVIDER === "none" ? null : getEnv().PAYMENT_PROVIDER;
  // Delivery areas the store offers, each with its price for this cart.
  const zones = options.zones.filter((zone) => zone.currency === currency);
  const hasZones = options.zones.length > 0;
  const byZone = Object.fromEntries(
    zones.map((zone) => [
      zone.id,
      pricedRows(cart.subtotalAmount, currency, zone, options.tax, true),
    ]),
  );
  const fallback = pricedRows(cart.subtotalAmount, currency, null, options.tax, hasZones);
  const zoneOptions = zones.map((zone) => {
    const fee = priceOrder(cart.subtotalAmount, zone, {
      ...options.tax,
      rateBasisPoints: 0,
    }).shippingAmount;
    return {
      value: zone.id,
      label: `${zone.name}: ${fee === 0 ? "free delivery" : formatMoney(fee, currency)}`,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        trail={[
          { name: "Home", href: "/" },
          { name: "Cart", href: "/cart" },
        ]}
        current="Checkout"
      />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Checkout</h1>

      {blocked ? (
        <Alert tone="error" testId="checkout-blocked">
          Something in your cart is no longer available in that quantity.{" "}
          <Link href="/cart" className="underline underline-offset-4">
            Review your cart
          </Link>{" "}
          before checking out.
        </Alert>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <AccountForm action={placeOrderAction} submitLabel="Place order" testId="checkout-form">
            <input type="hidden" name="expectedTotal" value={cart.subtotalAmount} />
            <input type="hidden" name="pricingVersion" value={options.version} />
            <Card title="Contact">
              {customer ? (
                <p className="text-sm" data-testid="checkout-email">
                  Signed in as <span className="font-medium">{customer.email}</span>. Your order
                  will appear in your account.
                </p>
              ) : (
                <>
                  <AccountField
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    hint="For your order confirmation."
                    required
                  />
                  <p className="text-sm text-ink-muted">
                    Have an account?{" "}
                    <Link
                      href="/account/sign-in?next=%2Fcheckout"
                      className="text-ink underline underline-offset-4"
                    >
                      Sign in
                    </Link>{" "}
                    first, or check out as a guest.
                  </p>
                </>
              )}
            </Card>
            <Card title="Delivery address">
              <AddressFields address={defaultAddress} />
              {hasZones ? (
                <AccountSelect
                  label="Delivery area"
                  name="shippingZoneId"
                  hint="The delivery price is added to your total."
                  required
                  defaultValue={zones.length === 1 ? zones[0]!.id : ""}
                  options={[{ value: "", label: "Choose your delivery area" }, ...zoneOptions]}
                />
              ) : null}
              {customer ? (
                <AccountCheckbox label="Save this address to my account" name="saveAddress" />
              ) : null}
            </Card>
            <Card title="Payment">
              <fieldset className="flex flex-col gap-3" data-testid="payment-methods">
                <legend className="sr-only">How will you pay?</legend>
                <label className="flex items-start gap-3 rounded-control border border-line p-3">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="cash_on_delivery"
                    defaultChecked
                    className="mt-1 size-5 accent-brand"
                  />
                  <span>
                    <span className="font-medium">Cash on delivery</span>
                    <span className="block text-sm text-ink-muted">
                      Pay the courier in cash when your order arrives. Add a phone number above so
                      the courier can reach you.
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
                        Pay online by card{online === "mock" ? " (test mode, no money moves)" : ""}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        Your items are held for {PAY_WITHIN_MINUTES} minutes while you pay.
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
              Your order
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              {cart.lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {line.quantity} × {line.productName}
                    {line.color || line.size ? (
                      <span className="text-ink-muted">
                        {" "}
                        ({[line.color, line.size].filter(Boolean).join(", ")})
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0">{formatMoney(line.lineTotalAmount, currency)}</span>
                </li>
              ))}
            </ul>
            <CheckoutAmounts selectId="shippingZoneId" byZone={byZone} fallback={fallback} />
            <Link href="/cart" className={buttonClasses("secondary")}>
              Edit cart
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}
