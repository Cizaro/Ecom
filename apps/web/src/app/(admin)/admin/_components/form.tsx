"use client";

import { Alert, buttonClasses, Field, type ButtonTone } from "@ecom/ui";
import {
  createContext,
  useActionState,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "../actions";

// Form behaviour for admin screens on top of the design system: pending state,
// server-action messages, and keeping what the user typed after a failed
// submit (actions return the safe values in `state.values`; passwords never).

const FormStateContext = createContext<FormState>({});

export function SubmitButton({
  children,
  tone = "primary",
}: {
  children: ReactNode;
  tone?: ButtonTone;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClasses(tone)}>
      {pending ? "Please wait…" : children}
    </button>
  );
}

/**
 * A text field inside an ActionForm. After a failed submit it shows the value
 * the action echoed back in `state.values[name]`, if any.
 */
export function TextField({
  name,
  ...props
}: { label: string; name: string; hint?: string } & Omit<
  ComponentProps<typeof Field>,
  "name" | "defaultValue"
>) {
  const state = useContext(FormStateContext);
  const kept = props.type === "password" ? undefined : state.values?.[name];
  // A changed key remounts the input so the kept value is shown even though
  // React resets the form after the action.
  return <Field key={kept ?? ""} name={name} defaultValue={kept} {...props} />;
}

export function FormMessages({ state }: { state: FormState }) {
  return (
    <>
      {state.error ? (
        <Alert tone="error" testId="form-error">
          {state.error}
        </Alert>
      ) : null}
      {state.notice ? (
        <Alert tone="success" testId="form-notice">
          {state.notice}
        </Alert>
      ) : null}
    </>
  );
}

/** A form bound to a server action that reports `{ error, notice, values }`. */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitTone,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  submitTone?: ButtonTone;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormMessages state={state} />
        {children}
        <SubmitButton tone={submitTone}>{submitLabel}</SubmitButton>
      </form>
    </FormStateContext.Provider>
  );
}
