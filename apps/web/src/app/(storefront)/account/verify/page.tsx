import type { Metadata } from "next";
import { AccountForm } from "../../_components/account-form";
import { verifyEmailAction } from "../actions";

export const metadata: Metadata = { title: "Confirm your email" };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Opening the emailed link does not confirm anything by itself: the shopper
// presses a button. Mail scanners and link previews fetch links
// automatically, and would otherwise use up the single-use link.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Params> }) {
  const token = first((await searchParams).token) ?? "";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Confirm your email</h1>
      <p className="text-ink-muted">One more step: confirm that this email address is yours.</p>
      <AccountForm
        action={verifyEmailAction}
        submitLabel="Confirm and sign in"
        testId="verify-form"
      >
        <input type="hidden" name="token" value={token.slice(0, 100)} />
      </AccountForm>
    </>
  );
}
