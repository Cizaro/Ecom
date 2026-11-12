import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export const inputClasses =
  "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink " +
  "placeholder:text-ink-subtle aria-invalid:border-danger";

/**
 * A labelled text input with optional hint and error. The label is always
 * visible; the hint and error are linked with aria-describedby.
 *
 * The element ID is the field name. Pass `id` when the same field name
 * appears more than once on a page (one form per list row, for example).
 */
export function Field({
  label,
  name,
  id = name,
  hint,
  error,
  className,
  ...input
}: {
  label: string;
  name: string;
  id?: string;
  hint?: string;
  error?: string;
} & Omit<ComponentProps<"input">, "name" | "id">) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
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

function FieldShell({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(describedBy)}
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

/** A labelled multi-line text input. */
export function TextArea({
  label,
  name,
  hint,
  error,
  className,
  rows = 4,
  ...textarea
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
} & Omit<ComponentProps<"textarea">, "name" | "id">) {
  return (
    <FieldShell label={label} id={name} hint={hint} error={error}>
      {(describedBy) => (
        <textarea
          id={name}
          name={name}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(inputClasses, "py-2", className)}
          {...textarea}
        />
      )}
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A labelled drop-down list. */
export function Select({
  label,
  name,
  id = name,
  hint,
  error,
  options,
  className,
  ...select
}: {
  label: string;
  name: string;
  id?: string;
  hint?: string;
  error?: string;
  options: readonly SelectOption[];
} & Omit<ComponentProps<"select">, "name" | "id" | "children">) {
  return (
    <FieldShell label={label} id={id} hint={hint} error={error}>
      {(describedBy) => (
        <select
          id={id}
          name={name}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(inputClasses, className)}
          {...select}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/** A checkbox with its label beside it. The whole row is the touch target. */
export function Checkbox({
  label,
  name,
  hint,
  ...input
}: { label: string; name: string; hint?: string } & Omit<
  ComponentProps<"input">,
  "name" | "id" | "type"
>) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          id={name}
          name={name}
          type="checkbox"
          aria-describedby={hintId}
          className="size-5 rounded border-line-strong accent-brand"
          {...input}
        />
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
