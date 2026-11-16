import { PASSWORD_MIN_LENGTH } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/server/customer";
import { AccountCheckbox, AccountField, AccountForm } from "../../_components/account-form";
import { signUpAction } from "../actions";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  if (await getCurrentCustomer()) redirect("/account");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Create an account</h1>
      <p className="text-ink-muted">
        An account keeps your addresses and your cart between devices. You do not need one to shop.
      </p>
      <AccountForm action={signUpAction} submitLabel="Create account" testId="sign-up-form">
        <AccountField label="Name" name="name" autoComplete="name" maxLength={200} />
        <AccountField label="Email" name="email" type="email" autoComplete="email" required />
        <AccountField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few words you will remember works well.`}
          required
        />
        {/* Unticked by default: agreeing to marketing is a choice the shopper makes. */}
        <AccountCheckbox
          label="Email me news and offers"
          name="marketing"
          hint="You can change this at any time in your account."
        />
      </AccountForm>
      <p className="text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/account/sign-in" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  );
}
