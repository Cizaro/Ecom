import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Admin shell. Sign-in arrives in Milestone 1.3 and the dashboard in 3.7.
// This page shows no data and performs no actions.
export default function AdminHomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
      <p className="text-neutral-600">The admin dashboard is under construction.</p>
    </main>
  );
}
