"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "../actions";

// Plain, accessible form pieces for the admin sign-in screens. The design
// system (Milestone 1.5) replaces the styling, not the behaviour.

export function SubmitButton({
  children,
  tone = "primary",
}: {
  children: ReactNode;
  tone?: "primary" | "quiet";
}) {
  const { pending } = useFormStatus();
  const tones = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-700",
    quiet: "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50",
  };
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60 ${tones[tone]}`}
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function TextField({
  label,
  name,
  hint,
  ...input
}: {
  label: string;
  name: string;
  hint?: string;
} & Omit<React.ComponentProps<"input">, "name" | "id" | "className">) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-describedby={hintId}
        className="min-h-11 rounded-md border border-neutral-300 px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900"
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-neutral-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessages({ state }: { state: FormState }) {
  return (
    <>
      {state.error ? (
        <p
          role="alert"
          data-testid="form-error"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p
          role="status"
          data-testid="form-notice"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900"
        >
          {state.notice}
        </p>
      ) : null}
    </>
  );
}

/** A form bound to a server action that reports `{ error, notice }`. */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitTone,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  submitTone?: "primary" | "quiet";
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessages state={state} />
      {children}
      <SubmitButton tone={submitTone}>{submitLabel}</SubmitButton>
    </form>
  );
}
