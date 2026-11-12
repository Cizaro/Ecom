import type { ReactNode } from "react";

// Shell for the screens that do not need a session: sign-in, password reset,
// second-factor challenge.
export default function PublicAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <main className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm">
        {children}
      </main>
    </div>
  );
}
