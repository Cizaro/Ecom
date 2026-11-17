import { PASSWORD_MIN_LENGTH } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/server/customer";
import { AccountCheckbox, AccountField, AccountForm } from "../../_components/account-form";
import { signUpAction } from "../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Create an account") };
}

export default async function SignUpPage() {
  const t = await shopT();
  if (await getCurrentCustomer()) redirect("/account");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("Create an account")}
      </h1>
      <p className="text-ink-muted">
        {t(
          "An account keeps your addresses and your cart between devices. You do not need one to shop.",
        )}
      </p>
      <AccountForm action={signUpAction} submitLabel={t("Create account")} testId="sign-up-form">
        <AccountField label={t("Name")} name="name" autoComplete="name" maxLength={200} />
        <AccountField label={t("Email")} name="email" type="email" autoComplete="email" required />
        <AccountField
          label={t("Password")}
          name="password"
          type="password"
          autoComplete="new-password"
          hint={t("At least {count} characters. A few words you will remember works well.", {
            count: PASSWORD_MIN_LENGTH,
          })}
          required
        />
        {/* Unticked by default: agreeing to marketing is a choice the shopper makes. */}
        <AccountCheckbox
          label={t("Email me news and offers")}
          name="marketing"
          hint={t("You can change this at any time in your account.")}
        />
      </AccountForm>
      <p className="text-sm text-ink-muted">
        {t("Already have an account?")}{" "}
        <Link href="/account/sign-in" className="text-ink underline underline-offset-4">
          {t("Sign in")}
        </Link>
      </p>
    </>
  );
}
