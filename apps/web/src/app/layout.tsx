import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { LOCALE_INFO } from "@ecom/i18n";
import { documentLocale } from "@/server/i18n";
import "./globals.css";

export const metadata: Metadata = {
  // Each area sets its own titles: "<page> | <store name>" in the shop, "<page> | Admin" for staff.
  title: "Store",
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
  const locale = await documentLocale();
  return (
    <html lang={locale} dir={LOCALE_INFO[locale].dir}>
      <body className="min-h-dvh bg-surface font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
