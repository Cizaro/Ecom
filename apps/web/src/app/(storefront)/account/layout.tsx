import type { Metadata } from "next";
import type { ReactNode } from "react";

// Account pages are personal: never in search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-6">{children}</div>;
}
