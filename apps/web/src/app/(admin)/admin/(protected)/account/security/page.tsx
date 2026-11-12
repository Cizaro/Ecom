import type { Metadata } from "next";
import { requireSession } from "@/server/auth";
import { ActionForm, SubmitButton, TextField } from "../../../_components/form";
import { disableTwoFactorAction, signOutEverywhereAction } from "../../../actions";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ enabled?: string; disabled?: string; required?: string }>;
}) {
  const { user, memberships } = await requireSession();
  const { enabled, disabled, required } = await searchParams;
  const requiredBy = memberships.filter((membership) => membership.requiresTwoFactor);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Security</h1>

      {required && !user.twoFactorEnabled && requiredBy.length > 0 ? (
        <p
          role="alert"
          data-testid="two-factor-required"
          className="rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-ink"
        >
          {requiredBy.map((membership) => membership.tenantName).join(", ")} requires two-factor
          authentication for your role. Turn it on below to continue.
        </p>
      ) : null}

      {enabled || disabled ? (
        <p
          role="status"
          className="rounded-control bg-success-soft px-3 py-2 text-sm text-success-ink"
        >
          Two-factor authentication is now {enabled ? "on" : "off"}.
        </p>
      ) : null}

      <section
        aria-labelledby="two-factor-heading"
        className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      >
        <div>
          <h2 id="two-factor-heading" className="text-lg font-semibold">
            Two-factor authentication
          </h2>
          <p className="mt-1 text-sm text-ink-muted" data-testid="two-factor-status">
            {user.twoFactorEnabled
              ? "On. You are asked for a code from your authenticator app when you sign in."
              : "Off. Turn it on to require a code from an authenticator app when you sign in."}
          </p>
        </div>
        <div className="max-w-sm">
          {user.twoFactorEnabled ? (
            <ActionForm
              action={disableTwoFactorAction}
              submitLabel="Turn off two-factor"
              submitTone="secondary"
            >
              <TextField
                label="Confirm your password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </ActionForm>
          ) : (
            <TwoFactorSetup />
          )}
        </div>
      </section>

      <section
        aria-labelledby="sessions-heading"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
      >
        <h2 id="sessions-heading" className="text-lg font-semibold">
          Sessions
        </h2>
        <p className="text-sm text-ink-muted">Signs you out on every device, including this one.</p>
        <form action={signOutEverywhereAction}>
          <SubmitButton tone="secondary">Sign out everywhere</SubmitButton>
        </form>
      </section>
    </div>
  );
}
