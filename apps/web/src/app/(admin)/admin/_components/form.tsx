"use client";

import {
  Alert,
  buttonClasses,
  Checkbox,
  Field,
  Select,
  TextArea,
  type ButtonTone,
  type SelectOption,
} from "@ecom/ui";
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
  defaultValue,
  ...props
}: { label: string; name: string; id?: string; hint?: string; defaultValue?: string } & Omit<
  ComponentProps<typeof Field>,
  "name" | "defaultValue"
>) {
  const state = useContext(FormStateContext);
  const kept = props.type === "password" ? undefined : state.values?.[name];
  const value = kept ?? defaultValue;
  // A changed key remounts the input so the kept value is shown even though
  // React resets the form after the action.
  return <Field key={value ?? ""} name={name} defaultValue={value} {...props} />;
}

/** Multi-line counterpart of TextField. */
export function TextAreaField({
  name,
  defaultValue,
  ...props
}: { label: string; name: string; hint?: string; defaultValue?: string } & Omit<
  ComponentProps<typeof TextArea>,
  "name" | "defaultValue"
>) {
  const value = useContext(FormStateContext).values?.[name] ?? defaultValue;
  return <TextArea key={value ?? ""} name={name} defaultValue={value} {...props} />;
}

export function SelectField({
  name,
  defaultValue,
  ...props
}: {
  label: string;
  name: string;
  id?: string;
  hint?: string;
  defaultValue?: string;
  options: readonly SelectOption[];
} & Omit<ComponentProps<typeof Select>, "name" | "defaultValue">) {
  const value = useContext(FormStateContext).values?.[name] ?? defaultValue;
  return <Select key={value ?? ""} name={name} defaultValue={value} {...props} />;
}

export function CheckboxField({
  name,
  defaultChecked,
  ...props
}: {
  label: string;
  name: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const values = useContext(FormStateContext).values;
  // After a failed submit the action echoes "on" for every ticked box.
  const checked = values ? values[name] === "on" : (defaultChecked ?? false);
  return <Checkbox key={String(checked)} name={name} defaultChecked={checked} {...props} />;
}

/**
 * Submit button for something that cannot be undone: asks the browser to
 * confirm first.
 */
export function ConfirmSubmitButton({
  children,
  confirmMessage,
}: {
  children: ReactNode;
  confirmMessage: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClasses("danger")}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? "Please wait…" : children}
    </button>
  );
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
  readOnly = false,
  testId,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  submitTone?: ButtonTone;
  /** Show the values without letting the user change or submit them. */
  readOnly?: boolean;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} className="flex flex-col gap-4" noValidate data-testid={testId}>
        <FormMessages state={state} />
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
          {children}
        </fieldset>
        {readOnly ? null : <SubmitButton tone={submitTone}>{submitLabel}</SubmitButton>}
      </form>
    </FormStateContext.Provider>
  );
}

/**
 * A form for an action that cannot be undone (delete). Shows the action's
 * error, if any, and asks for confirmation before submitting.
 */
export function DangerForm({
  action,
  children,
  submitLabel,
  confirmMessage,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  confirmMessage: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      <FormMessages state={state} />
      {children}
      <ConfirmSubmitButton confirmMessage={confirmMessage}>{submitLabel}</ConfirmSubmitButton>
    </form>
  );
}
