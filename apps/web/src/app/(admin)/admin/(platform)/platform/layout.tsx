import { buttonClasses } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/server/access";
import { signOutAction } from "../../actions";
import { PlatformNav } from "./platform-nav";

export const metadata: Metadata = { title: { default: "Platform", template: "%s · Platform" } };

// The platform owner's panel (D120): its own shell with a sidebar, separate
// from a shop's admin. Each page also calls requirePlatformAdmin() itself.
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="flex flex-col gap-6 bg-brand px-4 py-5 text-brand-contrast lg:min-h-dvh">
        <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-start">
          <Link href="/admin/platform" className="text-lg font-semibold tracking-tight">
            Platform
          </Link>
          <span className="text-xs opacity-80 lg:hidden">{session.user.email}</span>
        </div>
        <PlatformNav />
        <div className="mt-auto hidden flex-col gap-3 text-sm lg:flex">
          <span className="truncate opacity-80" data-testid="platform-email">
            {session.user.email}
          </span>
          {session.memberships.length > 0 ? (
            <Link
              href="/admin"
              className="underline underline-offset-4 opacity-90 hover:opacity-100"
            >
              Open a shop&apos;s admin
            </Link>
          ) : null}
          <form action={signOutAction}>
            <button
              type="submit"
              className={buttonClasses("secondary", "min-h-9 w-full px-3 text-ink")}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
        {children}
      </main>
    </div>
  );
}
