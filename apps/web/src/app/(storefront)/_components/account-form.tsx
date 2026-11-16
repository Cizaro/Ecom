"use client";

import {
  Alert,
  buttonClasses,
  Checkbox,
  Field,
  Select,
  TextArea,
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
import type { AccountFormState } from "../account/actions";

// Forms for the shopper's account pages: pending state, messages from the
// server action, and keeping what was typed after a refused submit
// (passwords are never sent back).

type AccountAction = (previous: AccountFormState, formData: FormData) => Promise<AccountFormState>;

const StateContext = createContext<AccountFormState>({});

export function SubmitButton({
  children,
  tone = "primary",
}: {
  children: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClasses(tone)}>
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function AccountForm({
  action,
  children,
  submitLabel,
  submitTone,
  testId,
}: {
  action: AccountAction;
  children?: ReactNode;
  submitLabel: string;
  submitTone?: "primary" | "secondary" | "danger";
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <StateContext.Provider value={state}>
      <form action={formAction} className="flex flex-col gap-4" noValidate data-testid={testId}>
        {state.error ? (
          <Alert tone="error" testId="account-error">
            {state.error}
          </Alert>
        ) : null}
        {state.notice ? (
          <Alert tone="success" testId="account-notice">
            {state.notice}
          </Alert>
        ) : null}
        {children}
        <div>
          <SubmitButton tone={submitTone}>{submitLabel}</SubmitButton>
        </div>
      </form>
    </StateContext.Provider>
  );
}

/** A text field that shows again what was typed when the form was refused. */
export function AccountField({
  name,
  defaultValue,
  ...props
}: { label: string; name: string; id?: string; hint?: string; defaultValue?: string } & Omit<
  ComponentProps<typeof Field>,
  "name" | "defaultValue"
>) {
  const state = useContext(StateContext);
  const kept = props.type === "password" ? undefined : state.values?.[name];
  const value = kept ?? defaultValue;
  return <Field key={value ?? ""} name={name} defaultValue={value} {...props} />;
}

/** Multi-line counterpart of AccountField. */
export function AccountTextArea({
  name,
  defaultValue,
  ...props
}: { label: string; name: string; id?: string; hint?: string; defaultValue?: string } & Omit<
  ComponentProps<typeof TextArea>,
  "name" | "defaultValue"
>) {
  const value = useContext(StateContext).values?.[name] ?? defaultValue;
  return <TextArea key={value ?? ""} name={name} defaultValue={value} {...props} />;
}

export function AccountSelect({
  name,
  defaultValue,
  ...props
}: {
  label: string;
  name: string;
  hint?: string;
  defaultValue?: string;
  options: readonly SelectOption[];
} & Omit<ComponentProps<typeof Select>, "name" | "defaultValue">) {
  const value = useContext(StateContext).values?.[name] ?? defaultValue;
  return <Select key={value ?? ""} name={name} defaultValue={value} {...props} />;
}

export function AccountCheckbox({
  name,
  defaultChecked,
  ...props
}: {
  label: string;
  name: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const values = useContext(StateContext).values;
  const checked = values ? values[name] === "on" : (defaultChecked ?? false);
  return <Checkbox key={String(checked)} name={name} defaultChecked={checked} {...props} />;
}

/** A single-button form (remove, make default, sign out) with its own message. */
export function ButtonForm({
  action,
  label,
  fields,
  tone = "secondary",
}: {
  action: AccountAction;
  label: string;
  fields?: Record<string, string>;
  tone?: "primary" | "secondary" | "danger";
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton tone={tone}>{label}</SubmitButton>
      {state.error ? (
        <Alert tone="error" testId="account-error">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
