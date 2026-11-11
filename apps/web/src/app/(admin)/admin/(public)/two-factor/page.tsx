import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth";
import { ActionForm, TextField } from "../../_components/form";
import { verifySecondFactorAction } from "../../actions";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ backup?: string }>;
}) {
  if (await getCurrentSession()) redirect("/admin");
  const useBackup = Boolean((await searchParams).backup);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Two-factor code</h1>
      <ActionForm action={verifySecondFactorAction} submitLabel="Verify">
        <input type="hidden" name="kind" value={useBackup ? "backup" : "totp"} />
        {useBackup ? (
          <TextField
            label="Backup code"
            name="code"
            autoComplete="off"
            hint="One of the codes you saved when you turned on two-factor authentication. Each works once."
            required
          />
        ) : (
          <TextField
            label="Code from your authenticator app"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
          />
        )}
      </ActionForm>
      <div className="flex flex-col gap-2 text-sm">
        {useBackup ? (
          <Link href="/admin/two-factor" className="underline underline-offset-4">
            Use the authenticator app instead
          </Link>
        ) : (
          <Link href="/admin/two-factor?backup=1" className="underline underline-offset-4">
            Use a backup code instead
          </Link>
        )}
        <Link href="/admin/sign-in" className="underline underline-offset-4">
          Start again
        </Link>
      </div>
    </div>
  );
}
