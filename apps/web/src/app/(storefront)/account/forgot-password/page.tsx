import type { Metadata } from "next";
import Link from "next/link";
import { AccountField, AccountForm } from "../../_components/account-form";
import { requestPasswordResetAction } from "../actions";

export const metadata: Metadata = { title: "Forgotten password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Forgotten password</h1>
      <p className="text-ink-muted">
        Enter the email address of your account and we will send you a link to choose a new
        password.
      </p>
      <AccountForm action={requestPasswordResetAction} submitLabel="Send link" testId="forgot-form">
        <AccountField label="Email" name="email" type="email" autoComplete="email" required />
      </AccountForm>
      <Link href="/account/sign-in" className="text-sm underline underline-offset-4">
        Back to sign in
      </Link>
    </>
  );
}
