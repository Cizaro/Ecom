import Link from "next/link";
import { requireSession } from "@/server/auth";

// Placeholder home for signed-in staff. The real dashboard is Milestone 3.7.
export default async function AdminHomePage() {
  const session = await requireSession();
  const { user, memberships } = session;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-neutral-600">
          Signed in as {user.name || user.email}. The dashboard is under construction.
        </p>
      </div>

      <section
        aria-labelledby="stores-heading"
        className="rounded-xl border border-neutral-200 bg-white p-5"
      >
        <h2 id="stores-heading" className="text-lg font-semibold">
          Your access
        </h2>
        {memberships.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            {user.isPlatformAdmin
              ? "You are a platform administrator and are not a member of any store."
              : "You are not a member of any store yet. Ask a store owner to add you."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200">
            {memberships.map((membership) => (
              <li
                key={membership.tenantId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="font-medium">{membership.tenantName}</span>
                <span className="text-sm text-neutral-600">{membership.roleName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!user.twoFactorEnabled ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Two-factor authentication is off for your account.{" "}
          <Link href="/admin/account/security" className="font-medium underline underline-offset-4">
            Turn it on
          </Link>
        </p>
      ) : null}
    </div>
  );
}
