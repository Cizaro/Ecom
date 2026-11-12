import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Store", template: "%s | Store" },
  description: "Bags, wallets, watches, jewelry and fashion accessories.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading request headers makes every page render on request, which
  // the Content Security Policy needs: a page built ahead of time would carry
  // no nonce and its scripts would be blocked.
  await headers();
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
