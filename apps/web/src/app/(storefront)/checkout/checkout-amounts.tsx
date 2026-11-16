"use client";

import { useEffect, useState } from "react";

/** Sent on the document when the summary's figures change (a discount code applied). */
export const PRICING_EVENT = "checkout:pricing";

export interface PricedRows {
  rows: [label: string, value: string][];
  total: string;
}

/**
 * The amounts in the checkout summary. Every figure was worked out on the
 * server for each delivery area; this only shows the one that matches the
 * area picked in the form (and is worked out again when the order is placed).
 */
export function CheckoutAmounts({
  selectId,
  byZone,
  fallback,
}: {
  selectId: string;
  byZone: Record<string, PricedRows>;
  fallback: PricedRows;
}) {
  const [zoneId, setZoneId] = useState("");
  // Replaced when a discount code is applied (see discount-field.tsx).
  const [pricing, setPricing] = useState({ byZone, fallback });

  useEffect(() => {
    const onPricing = (event: Event) => {
      const detail = (
        event as CustomEvent<{ byZone: Record<string, PricedRows>; fallback: PricedRows }>
      ).detail;
      if (detail?.fallback) setPricing(detail);
    };
    document.addEventListener(PRICING_EVENT, onPricing);
    return () => document.removeEventListener(PRICING_EVENT, onPricing);
  }, []);

  useEffect(() => {
    const read = () => {
      const select = document.getElementById(selectId);
      setZoneId(select instanceof HTMLSelectElement ? select.value : "");
    };
    read();
    // Listen on the document: the select is re-created after a failed submit.
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLSelectElement && event.target.id === selectId) read();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [selectId]);

  const current = pricing.byZone[zoneId] ?? pricing.fallback;
  return (
    <dl className="flex flex-col gap-1 border-t border-line pt-3 text-sm" aria-live="polite">
      {current.rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3" data-testid="checkout-amount">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div className="flex justify-between text-base font-semibold">
        <dt>Total</dt>
        <dd data-testid="checkout-total">{current.total}</dd>
      </div>
    </dl>
  );
}
