import { getCart, MAX_LINE_QUANTITY, productNamesBySlug } from "@ecom/core";
import { Alert, buttonClasses, EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { cartOwner } from "@/server/customer";
import { shopT } from "@/server/i18n";
import { viewOf } from "@/server/media";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { CartLineControls } from "../_components/cart-forms";
import { removeCartItemAction, updateCartItemAction } from "./actions";

// A cart is personal: keep it out of search engines.
export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Your cart"), robots: { index: false, follow: false } };
}

/** The product page address with this line's colour and size chosen. */
function linePath(line: { productSlug: string; color: string | null; size: string | null }) {
  const query = new URLSearchParams();
  if (line.color) query.set("color", line.color.trim().toLowerCase());
  if (line.size) query.set("size", line.size.trim().toLowerCase());
  const text = query.toString();
  return text ? `/p/${line.productSlug}?${text}` : `/p/${line.productSlug}`;
}

export default async function CartPage() {
  const [{ db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const cart = await getCart(db, await cartOwner());
  const currency = cart.currency ?? "USD";
  const names = await productNamesBySlug(
    db,
    t.locale,
    cart.lines.map((line) => line.productSlug),
  );
  const nameOf = (line: { productSlug: string; productName: string }) =>
    names.get(line.productSlug) ?? line.productName;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ name: t("Home"), href: "/" }]} current={t("Your cart")} />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Your cart")}</h1>

      {cart.lines.length === 0 ? (
        <EmptyState title={t("Your cart is empty")}>
          <Link href="/products" className="underline underline-offset-4">
            {t("See all products")}
          </Link>
        </EmptyState>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <ul
            className="flex flex-col divide-y divide-line border-y border-line"
            data-testid="cart"
          >
            {cart.lines.map((line) => {
              const options = [line.color, line.size].filter(Boolean).join(" · ");
              return (
                <li key={line.id} className="flex gap-4 py-4" data-testid="cart-line">
                  <div className="size-20 shrink-0 overflow-hidden rounded-control bg-surface-muted sm:size-24">
                    {line.image ? (
                      <MediaImage
                        image={viewOf(line.image)}
                        alt=""
                        sizes="96px"
                        className="size-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <Link
                          href={linePath(line)}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {nameOf(line)}
                        </Link>
                        {options ? <p className="text-sm text-ink-muted">{options}</p> : null}
                        <p className="text-sm text-ink-muted">
                          {t("{price} each", { price: t.money(line.unitPriceAmount, currency) })}
                        </p>
                      </div>
                      {line.available ? (
                        <p className="font-medium" data-testid="line-total">
                          {t.money(line.lineTotalAmount, currency)}
                        </p>
                      ) : null}
                    </div>
                    {line.outOfStock ? (
                      <Alert tone="error" testId="line-out-of-stock">
                        {t(
                          "This item has sold out since you added it. It is not included in the total.",
                        )}
                      </Alert>
                    ) : !line.available ? (
                      <Alert tone="error" testId="line-unavailable">
                        {t("This item is no longer available. It is not included in the total.")}
                      </Alert>
                    ) : line.onlyLeft !== null ? (
                      <Alert tone="warning" testId="line-only-left">
                        {t(
                          "Only {count} left. Lower the quantity to {count} or fewer to buy this item.",
                          { count: line.onlyLeft },
                        )}
                      </Alert>
                    ) : line.priceWas !== null ? (
                      <Alert tone="info" testId="line-price-changed">
                        {t("The price changed from {was} to {now} since you added this.", {
                          was: t.money(line.priceWas, currency),
                          now: t.money(line.unitPriceAmount, currency),
                        })}
                      </Alert>
                    ) : null}
                    <CartLineControls
                      updateAction={updateCartItemAction}
                      removeAction={removeCartItemAction}
                      itemId={line.id}
                      quantity={line.quantity}
                      maxQuantity={MAX_LINE_QUANTITY}
                      label={[nameOf(line), options].filter(Boolean).join(", ")}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <section
            aria-labelledby="cart-summary"
            className="flex h-fit flex-col gap-4 rounded-card border border-line p-5"
          >
            <h2 id="cart-summary" className="text-lg font-semibold">
              {t("Summary")}
            </h2>
            <div className="flex items-baseline justify-between gap-4">
              <span>{t("Subtotal")}</span>
              <span className="text-lg font-semibold" data-testid="cart-subtotal">
                {t.money(cart.subtotalAmount, currency)}
              </span>
            </div>
            <p className="text-sm text-ink-muted">
              {t("Shipping and taxes are worked out at checkout.")}
            </p>
            {cart.hasUnavailable || cart.lines.some((line) => line.onlyLeft !== null) ? (
              <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                {t("Remove or change the items marked above to check out.")}
              </p>
            ) : (
              <Link href="/checkout" className={buttonClasses()} data-testid="checkout-link">
                {t("Check out")}
              </Link>
            )}
            <Link href="/products" className={buttonClasses("secondary")}>
              {t("Continue shopping")}
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}
