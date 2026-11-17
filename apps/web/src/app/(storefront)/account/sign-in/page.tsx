import { Alert } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer, safeReturnPath } from "@/server/customer";
import { AccountField, AccountForm } from "../../_components/account-form";
import { signInAction } from "../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Sign in") };
}

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await shopT();
  const params = await searchParams;
  const next = safeReturnPath(first(params.next));
  if (await getCurrentCustomer()) redirect(next);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Sign in")}</h1>
      {first(params.reset) ? (
        <Alert tone="success" testId="account-notice">
          {t("Your password has been changed. Sign in with the new one.")}
        </Alert>
      ) : null}
      <AccountForm action={signInAction} submitLabel={t("Sign in")} testId="sign-in-form">
        <input type="hidden" name="next" value={next} />
        <AccountField label={t("Email")} name="email" type="email" autoComplete="email" required />
        <AccountField
          label={t("Password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </AccountForm>
      <div className="flex flex-col gap-2 text-sm">
        <Link href="/account/forgot-password" className="underline underline-offset-4">
          {t("Forgotten your password?")}
        </Link>
        <p className="text-ink-muted">
          {t("New here?")}{" "}
          <Link href="/account/sign-up" className="text-ink underline underline-offset-4">
            {t("Create an account")}
          </Link>{" "}
          {t("You can also check out without one.")}
        </p>
      </div>
    </>
  );
}
