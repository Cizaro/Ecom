import "server-only";

import type { Translator } from "@ecom/i18n";
import {
  orderAmountLines,
  priceOrder,
  type AppliedDiscount,
  type CheckoutOptions,
  type ShippingZoneView,
  type TaxSettings,
} from "@ecom/core";
import type { PricedRows } from "@/app/(storefront)/checkout/checkout-amounts";

// The checkout summary's figures, worked out on the server for each delivery
// area the shopper may pick (and with a discount code, once one is applied).
// The order is priced again from the database when it is placed.

function pricedRows(
  subtotal: number,
  currency: string,
  zone: ShippingZoneView | null,
  tax: TaxSettings,
  hasZones: boolean,
  discount: AppliedDiscount | null,
  t: Translator,
): PricedRows {
  const pricing = priceOrder(subtotal, zone, tax, discount);
  const rows = orderAmountLines(
    {
      ...pricing,
      currency,
      shippingZoneName: zone?.name ?? null,
      taxRateBasisPoints: tax.rateBasisPoints,
      taxLabel: tax.label,
      discountCode: discount?.code ?? null,
    },
    t,
  );
  if (hasZones && !zone) rows.splice(1, 0, [t("Delivery"), t("Choose your area")]);
  return { rows, total: t.money(pricing.totalAmount, currency) };
}

export interface SummaryPricing {
  byZone: Record<string, PricedRows>;
  fallback: PricedRows;
}

export function summaryPricing(
  subtotal: number,
  currency: string,
  options: CheckoutOptions,
  discount: AppliedDiscount | null,
  /** Labels and amounts in the shopper's language. */
  t: Translator,
): SummaryPricing {
  const zones = options.zones.filter((zone) => zone.currency === currency);
  const hasZones = options.zones.length > 0;
  return {
    byZone: Object.fromEntries(
      zones.map((zone) => [
        zone.id,
        pricedRows(subtotal, currency, zone, options.tax, true, discount, t),
      ]),
    ),
    fallback: pricedRows(subtotal, currency, null, options.tax, hasZones, discount, t),
  };
}
