import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth";
import { ActionForm, TextField } from "../../_components/form";
import { signInAction } from "../../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  if (await getCurrentSession()) redirect("/admin");
  const { reset } = await searchParams;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      {reset ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Your password has been changed. Sign in with the new password.
        </p>
      ) : null}
      <ActionForm action={signInAction} submitLabel="Sign in">
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </ActionForm>
      <Link href="/admin/forgot-password" className="text-sm underline underline-offset-4">
        Forgot your password?
      </Link>
    </div>
  );
}
