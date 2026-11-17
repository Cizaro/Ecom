import type { Metadata } from "next";
import Link from "next/link";
import { AccountField, AccountForm } from "../../_components/account-form";
import { requestPasswordResetAction } from "../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Forgotten password") };
}

export default async function ForgotPasswordPage() {
  const t = await shopT();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("Forgotten password")}
      </h1>
      <p className="text-ink-muted">
        {t(
          "Enter the email address of your account and we will send you a link to choose a new password.",
        )}
      </p>
      <AccountForm
        action={requestPasswordResetAction}
        submitLabel={t("Send link")}
        testId="forgot-form"
      >
        <AccountField label={t("Email")} name="email" type="email" autoComplete="email" required />
      </AccountForm>
      <Link href="/account/sign-in" className="text-sm underline underline-offset-4">
        {t("Back to sign in")}
      </Link>
    </>
  );
}
