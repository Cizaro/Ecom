import Link from "next/link";
import type { ReactNode } from "react";
import { requireSession } from "@/server/auth";
import { signOutAction } from "../actions";

// Shell for signed-in pages. Layouts are not re-run on every navigation, so
// each protected page also calls requireSession() itself.
export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Admin" className="flex items-center gap-4 text-sm font-medium">
            <Link href="/admin">Admin</Link>
            <Link href="/admin/account/security" className="text-neutral-600">
              Security
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-600" data-testid="signed-in-email">
              {session.user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="min-h-9 rounded-md border border-neutral-300 bg-white px-3 font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
