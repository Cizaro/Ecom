"use client";

import { Alert, buttonClasses } from "@ecom/ui";
import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export interface ConnectState {
  error?: string;
  /** Meta's sign-in address (or, in test mode, our own callback). */
  goTo?: string;
}

function Submit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={buttonClasses()} disabled={pending}>
      {pending ? "Opening Meta…" : children}
    </button>
  );
}

/**
 * Starts the Meta sign-in. The page is left with a full navigation, because
 * Meta's sign-in (and the callback it returns to) are not admin screens.
 */
export function ConnectMetaForm({
  action,
  children,
}: {
  action: (previous: ConnectState) => Promise<ConnectState>;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  useEffect(() => {
    if (state.goTo) window.location.assign(state.goTo);
  }, [state.goTo]);
  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="meta-connect">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {children}
      <div>
        <Submit>Connect Facebook and Instagram</Submit>
      </div>
    </form>
  );
}
