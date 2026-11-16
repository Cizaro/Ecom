"use client";

import { useState, useTransition } from "react";
import { buttonClasses } from "@ecom/ui";
import { AccountField } from "../_components/account-form";
import { previewDiscountAction } from "./actions";
import { PRICING_EVENT } from "./checkout-amounts";

/**
 * The discount code box. The code is sent with the order and checked there;
 * "Apply" checks it now and updates the summary's total, so the shopper sees
 * the price before ordering. Without JavaScript the code still applies when
 * the order is placed.
 */
export function DiscountField() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    const input = document.getElementById("discountCode");
    const code = input instanceof HTMLInputElement ? input.value : "";
    startTransition(async () => {
      const result = await previewDiscountAction(code);
      setMessage(result.message ? { ok: result.ok, text: result.message } : null);
      if (result.pricing) {
        document.dispatchEvent(new CustomEvent(PRICING_EVENT, { detail: result.pricing }));
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <AccountField label="Code" name="discountCode" autoComplete="off" hint="Optional" />
        </div>
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className={buttonClasses("secondary")}
          data-testid="apply-discount"
        >
          {pending ? "Checking…" : "Apply"}
        </button>
      </div>
      {message ? (
        <p
          role="status"
          className={message.ok ? "text-sm text-success-ink" : "text-sm text-danger-ink"}
          data-testid="discount-message"
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
