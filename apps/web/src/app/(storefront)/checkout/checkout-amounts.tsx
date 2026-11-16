"use client";

import { useEffect, useState } from "react";

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

  const current = byZone[zoneId] ?? fallback;
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
