import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, TextField } from "../../_components/form";
import { requestPasswordResetAction } from "../../actions";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="text-sm text-ink-muted">
        Enter your email address and we will send you a link to choose a new password.
      </p>
      <ActionForm action={requestPasswordResetAction} submitLabel="Send reset link">
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
        />
      </ActionForm>
      <Link href="/admin/sign-in" className="text-sm underline underline-offset-4">
        Back to sign in
      </Link>
    </div>
  );
}
