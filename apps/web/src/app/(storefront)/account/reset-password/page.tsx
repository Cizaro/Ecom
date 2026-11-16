import { PASSWORD_MIN_LENGTH } from "@ecom/core";
import type { Metadata } from "next";
import { AccountField, AccountForm } from "../../_components/account-form";
import { resetPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Choose a new password" };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const token = first((await searchParams).token) ?? "";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Choose a new password</h1>
      <p className="text-ink-muted">You will be signed out on every device once it is changed.</p>
      <AccountForm action={resetPasswordAction} submitLabel="Save new password" testId="reset-form">
        <input type="hidden" name="token" value={token.slice(0, 100)} />
        <AccountField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          required
        />
      </AccountForm>
    </>
  );
}
