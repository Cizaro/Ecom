import Link from "next/link";
import type { ReactNode } from "react";
import { hasPermission } from "@ecom/core";
import { getAccessOutcome } from "@/server/access";
import { requireSession } from "@/server/auth";
import { signOutAction } from "../actions";

// Shell for signed-in pages. Layouts are not re-run on every navigation, so
// each protected page also calls requireSession() itself.
export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const outcome = await getAccessOutcome();
  const context = "context" in outcome ? outcome.context : null;

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Admin" className="flex items-center gap-4 text-sm font-medium">
            <Link href="/admin">Admin</Link>
            {context ? (
              <Link href="/admin/access" className="text-neutral-600">
                Access
              </Link>
            ) : null}
            {context && hasPermission(context, "staff.manage") ? (
              <Link href="/admin/team" className="text-neutral-600">
                Team
              </Link>
            ) : null}
            <Link href="/admin/account/security" className="text-neutral-600">
              Security
            </Link>
          </nav>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {session.memberships.length > 1 ? (
              <Link
                href="/admin/select-store"
                className="font-medium underline underline-offset-4"
                data-testid="active-store"
              >
                {context?.tenantName ?? "Choose a store"}
              </Link>
            ) : context ? (
              <span className="font-medium" data-testid="active-store">
                {context.tenantName}
              </span>
            ) : null}
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
