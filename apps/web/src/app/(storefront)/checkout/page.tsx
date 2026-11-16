import { getEnv } from "@ecom/config";
import { formatMoney, getCart, listAddresses, PAY_WITHIN_MINUTES } from "@ecom/core";
import { Alert, buttonClasses, Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cartOwner, getCurrentCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { AccountCheckbox, AccountField, AccountForm } from "../_components/account-form";
import { AddressFields } from "../_components/address-fields";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { placeOrderAction } from "./actions";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

// One page: who you are, where it goes, what it costs. Every amount shown
// here is worked out on the server again when the order is placed; if it
// changed in between, the order is not placed and the shopper is told.
export default async function CheckoutPage() {
  const { db } = await storefrontDb();
  const [cart, customer] = await Promise.all([
    cartOwner().then((owner) => getCart(db, owner)),
    getCurrentCustomer(),
  ]);
  if (cart.lines.length === 0) redirect("/cart");
  const currency = cart.currency ?? "USD";
  const blocked = cart.lines.some((line) => !line.available || line.onlyLeft !== null);
  const saved = customer ? await listAddresses(db, customer.id) : [];
  const defaultAddress = saved.find((address) => address.isDefaultShipping);
  // Cash on delivery is always offered; paying online only when a provider is set up.
  const online = getEnv().PAYMENT_PROVIDER === "none" ? null : getEnv().PAYMENT_PROVIDER;

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
            <dl className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{formatMoney(cart.subtotalAmount, currency)}</dd>
              </div>
              <div className="flex justify-between text-ink-muted">
                <dt>Shipping and tax</dt>
                <dd>Not charged yet</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd data-testid="checkout-total">{formatMoney(cart.subtotalAmount, currency)}</dd>
              </div>
            </dl>
            <Link href="/cart" className={buttonClasses("secondary")}>
              Edit cart
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}
