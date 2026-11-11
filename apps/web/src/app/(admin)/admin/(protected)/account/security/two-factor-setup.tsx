"use client";

import { useActionState } from "react";
import { ActionForm, FormMessages, SubmitButton, TextField } from "../../../_components/form";
import {
  beginTwoFactorSetupAction,
  confirmTwoFactorSetupAction,
  type TwoFactorSetupState,
} from "../../../actions";

const initial: TwoFactorSetupState = {};

/** Two steps: confirm the password to get a secret, then prove a code works. */
export function TwoFactorSetup() {
  const [state, begin] = useActionState(beginTwoFactorSetupAction, initial);

  if (!state.setup) {
    return (
      <form action={begin} className="flex flex-col gap-4" noValidate>
        <FormMessages state={state} />
        <TextField
          label="Confirm your password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton>Set up two-factor</SubmitButton>
      </form>
    );
  }

  const { secret, totpUri, backupCodes } = state.setup;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-sm">
        <p>
          <span className="font-medium">1.</span> Add this account to your authenticator app. On
          this phone,{" "}
          <a href={totpUri} className="underline underline-offset-4">
            open the authenticator app
          </a>
          . Otherwise choose “enter a setup key” in the app and type this key:
        </p>
        <code
          data-testid="totp-secret"
          className="rounded-md bg-neutral-100 px-3 py-2 font-mono text-sm break-all select-all"
        >
          {secret}
        </code>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <p>
          <span className="font-medium">2.</span> Save these backup codes somewhere safe. Each one
          works once if you lose your phone. They are not shown again.
        </p>
        <ul
          data-testid="backup-codes"
          className="grid grid-cols-2 gap-1 rounded-md bg-neutral-100 px-3 py-2 font-mono text-sm"
        >
          {backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <p>
          <span className="font-medium">3.</span> Enter the 6-digit code the app shows to finish.
        </p>
        <ActionForm action={confirmTwoFactorSetupAction} submitLabel="Turn on two-factor">
          <TextField
            label="Code from your authenticator app"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
          />
        </ActionForm>
      </div>
    </div>
  );
}
