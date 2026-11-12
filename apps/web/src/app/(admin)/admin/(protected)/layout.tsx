import { buttonClasses } from "@ecom/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAccessOutcome } from "@/server/access";
import { visibleNav } from "@/server/admin-nav";
import { requireSession } from "@/server/auth";
import { signOutAction } from "../actions";
import { NavLinks } from "../_components/nav-links";

// Shell for signed-in pages. Layouts are not re-run on every navigation, so
// each protected page also calls its own guard.
export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const outcome = await getAccessOutcome();
  const context = outcome.status === "ok" ? outcome.context : null;

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/admin" className="font-semibold tracking-tight">
                Store Admin
              </Link>
              {session.memberships.length > 1 ? (
                <Link
                  href="/admin/select-store"
                  className="truncate text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
                  data-testid="active-store"
                >
                  {"context" in outcome ? outcome.context.tenantName : "Choose a store"}
                </Link>
              ) : "context" in outcome ? (
                <span className="truncate text-sm text-ink-muted" data-testid="active-store">
                  {outcome.context.tenantName}
                </span>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <span className="max-w-48 truncate text-ink-muted" data-testid="signed-in-email">
                {session.user.email}
              </span>
              <form action={signOutAction}>
                <button type="submit" className={buttonClasses("secondary", "min-h-9 px-3")}>
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <nav aria-label="Admin">
            <NavLinks items={visibleNav(context)} />
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
