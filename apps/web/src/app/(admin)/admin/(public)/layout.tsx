import type { ReactNode } from "react";

// Shell for the screens that do not need a session: sign-in, password reset,
// second-factor challenge.
export default function PublicAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-10">
      <main className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        {children}
      </main>
    </div>
  );
}
