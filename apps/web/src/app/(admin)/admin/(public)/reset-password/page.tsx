import { PASSWORD_MIN_LENGTH } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, TextField } from "../../_components/form";
import { resetPasswordAction } from "../../actions";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The address contains the reset token; never send it to other sites.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">Link not valid</h1>
        <p className="text-sm text-ink-muted">
          This password reset link is incomplete. Request a new one.
        </p>
        <Link href="/admin/forgot-password" className="text-sm underline underline-offset-4">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} submitLabel="Change password">
        <input type="hidden" name="token" value={token} />
        <TextField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          required
        />
        <TextField
          label="Repeat new password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
        />
      </ActionForm>
    </div>
  );
}
