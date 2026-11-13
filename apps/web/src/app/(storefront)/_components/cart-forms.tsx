"use client";

import { Alert, buttonClasses, inputClasses } from "@ecom/ui";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { CartFormState } from "../cart/actions";

type CartAction = (previous: CartFormState, formData: FormData) => Promise<CartFormState>;

function Submit({
  children,
  tone = "primary",
  className,
}: {
  children: string;
  tone?: "primary" | "secondary";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClasses(tone, className)}
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

function quantityOptions(max: number, current?: number) {
  const top = Math.max(max, current ?? 1);
  return Array.from({ length: top }, (_, index) => index + 1);
}

/** Quantity and "Add to cart" for the variant chosen on a product page. */
export function AddToCartForm({
  action,
  variantId,
  maxQuantity,
}: {
  action: CartAction;
  variantId: string;
  maxQuantity: number;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="add-to-cart">
      <input type="hidden" name="variantId" value={variantId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="quantity" className="text-sm font-medium">
            Quantity
          </label>
          <select id="quantity" name="quantity" defaultValue="1" className={`${inputClasses} w-24`}>
            {quantityOptions(maxQuantity).map((quantity) => (
              <option key={quantity} value={quantity}>
                {quantity}
              </option>
            ))}
          </select>
        </div>
        <Submit className="flex-1 sm:flex-none sm:px-8">Add to cart</Submit>
      </div>
      {state.error ? (
        <Alert tone="error" testId="cart-error">
          {state.error}
        </Alert>
      ) : null}
      {state.notice ? (
        <div className="flex flex-wrap items-center gap-3">
          <Alert tone="success" testId="cart-notice">
            {state.notice}
          </Alert>
          <Link href="/cart" className="text-sm font-medium underline underline-offset-4">
            View cart
          </Link>
        </div>
      ) : null}
    </form>
  );
}

/** Quantity of one cart line, with its own Update button, and a Remove button. */
export function CartLineControls({
  updateAction,
  removeAction,
  itemId,
  quantity,
  maxQuantity,
  label,
}: {
  updateAction: CartAction;
  removeAction: CartAction;
  itemId: string;
  quantity: number;
  maxQuantity: number;
  /** What the line is, for screen-reader labels. */
  label: string;
}) {
  const [updateState, update] = useActionState(updateAction, {});
  const [removeState, remove] = useActionState(removeAction, {});
  const error = updateState.error ?? removeState.error;
  const fieldId = `quantity-${itemId}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <form action={update} className="flex items-end gap-2">
          <input type="hidden" name="itemId" value={itemId} />
          <div className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-sm text-ink-muted">
              Quantity<span className="sr-only"> of {label}</span>
            </label>
            <select
              // The key resets the control when the saved quantity changes.
              key={quantity}
              id={fieldId}
              name="quantity"
              defaultValue={String(quantity)}
              className={`${inputClasses} w-20`}
            >
              {quantityOptions(maxQuantity, quantity).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <Submit tone="secondary">Update</Submit>
        </form>
        <form action={remove}>
          <input type="hidden" name="itemId" value={itemId} />
          <button
            type="submit"
            className="flex min-h-11 items-center px-2 text-sm underline underline-offset-4"
          >
            Remove<span className="sr-only"> {label}</span>
          </button>
        </form>
      </div>
      {error ? (
        <Alert tone="error" testId="cart-error">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
