import type { Metadata } from "next";
import { AccountForm } from "../../_components/account-form";
import { verifyEmailAction } from "../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Confirm your email") };
}

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Opening the emailed link does not confirm anything by itself: the shopper
// presses a button. Mail scanners and link previews fetch links
// automatically, and would otherwise use up the single-use link.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await shopT();
  const token = first((await searchParams).token) ?? "";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("Confirm your email")}
      </h1>
      <p className="text-ink-muted">
        {t("One more step: confirm that this email address is yours.")}
      </p>
      <AccountForm
        action={verifyEmailAction}
        submitLabel={t("Confirm and sign in")}
        testId="verify-form"
      >
        <input type="hidden" name="token" value={token.slice(0, 100)} />
      </AccountForm>
    </>
  );
}
