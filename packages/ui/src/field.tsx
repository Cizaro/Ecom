import type { ComponentProps } from "react";
import { cx } from "./cx";

export const inputClasses =
  "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink " +
  "placeholder:text-ink-subtle aria-invalid:border-danger";

/**
 * A labelled text input with optional hint and error. The label is always
 * visible; the hint and error are linked with aria-describedby.
 */
export function Field({
  label,
  name,
  hint,
  error,
  className,
  ...input
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
} & Omit<ComponentProps<"input">, "name" | "id">) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(inputClasses, className)}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
