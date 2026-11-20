"use client";

import type { SHOP_TEMPLATES } from "@ecom/core";
import { Alert, buttonClasses, Checkbox, Field } from "@ecom/ui";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signUpShopAction, type SignUpState } from "./actions";
import { TemplatePreview } from "../parts";

type Template = (typeof SHOP_TEMPLATES)[number];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClasses("primary", "w-full")}
    >
      {pending ? "Creating your shop…" : "Create my shop"}
    </button>
  );
}

export function SignUpForm({
  templates,
  suffix,
  initialTemplate,
}: {
  templates: Template[];
  suffix: string;
  initialTemplate: string;
}) {
  const [state, action] = useActionState<SignUpState, FormData>(signUpShopAction, {});
  const v = state.values ?? {};
  const errorFor = (name: string) => (state.field === name ? state.error : undefined);
  const chosen = v.template || initialTemplate;
  // A remount after each failed submit shows the kept values (React resets the form).
  const key = JSON.stringify(v);
  return (
    <form
      action={action}
      noValidate
      className="flex flex-col gap-6"
      data-testid="signup-form"
      key={key}
    >
      {state.error && !state.field ? (
        <Alert tone="error" testId="form-error">
          {state.error}
        </Alert>
      ) : null}
      {state.error && state.field ? (
        <p className="sr-only" role="alert">
          {state.error}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">About you</legend>
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          defaultValue={v.name}
          error={errorFor("name")}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={v.email}
          error={errorFor("email")}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least 10 characters."
          error={errorFor("password")}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">Your shop</legend>
        <Field
          label="Shop name"
          name="shopName"
          required
          maxLength={80}
          defaultValue={v.shopName}
          error={errorFor("shopName")}
        />
        <Field
          label="Web address"
          name="address"
          required
          maxLength={30}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={v.address}
          hint={`Your shop's free address: yourname.${suffix}. Lower-case letters, digits and dashes.`}
          error={errorFor("address")}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-semibold">Design</legend>
        <p className="text-sm text-ink-muted">You can change colours, font and logo later.</p>
        {errorFor("template") ? (
          <p className="text-sm text-danger-ink">{errorFor("template")}</p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <label
              key={t.key}
              className="flex cursor-pointer flex-col gap-2 rounded-card border border-line p-3 has-[:checked]:border-brand has-[:checked]:ring-2 has-[:checked]:ring-brand has-[:focus-visible]:outline-2"
            >
              <TemplatePreview template={t} />
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="template"
                  value={t.key}
                  defaultChecked={chosen === t.key}
                  className="size-4 accent-brand"
                />
                <span className="font-medium">{t.name}</span>
              </span>
              <span className="text-xs text-ink-muted">{t.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <Checkbox
          name="acceptTerms"
          label="I agree to the terms of service and the privacy policy"
          defaultChecked={v.acceptTerms === "on"}
        />
        {errorFor("acceptTerms") ? (
          <p className="text-sm text-danger-ink">{errorFor("acceptTerms")}</p>
        ) : null}
      </div>

      <Submit />
      <p className="text-center text-sm text-ink-muted">
        Already have a shop?{" "}
        <Link href="/admin/sign-in" className="font-medium text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
