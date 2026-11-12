"use client";

import { buttonClasses } from "@ecom/ui";

// Shown when a page throws. The details are in the server log under the
// digest; the visitor sees only a reference to quote to support.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-ink-muted">
        Please try again. If it keeps happening, contact support
        {error.digest ? (
          <>
            {" "}
            and quote reference <code className="font-mono">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div>
        <button type="button" onClick={reset} className={buttonClasses("primary")}>
          Try again
        </button>
      </div>
    </main>
  );
}
