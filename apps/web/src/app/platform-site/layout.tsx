import { getEnv } from "@ecom/config";
import { buttonClasses } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { requirePlatformSite } from "@/server/platform-site";

export async function generateMetadata(): Promise<Metadata> {
  const name = getEnv().PLATFORM_NAME;
  const index = getEnv().ALLOW_SEARCH_INDEXING;
  return {
    title: { default: `${name}: your online shop with an AI assistant`, template: `%s | ${name}` },
    description:
      "An online shop, an owner's dashboard and an AI assistant that answers Instagram and Facebook messages. Start with a free 14-day trial.",
    robots: { index, follow: index },
  };
}

// The platform's own look: deep indigo, separate from any shop's colours.
const THEME = {
  "--color-brand": "#312e81",
  "--color-brand-hover": "#3730a3",
  "--color-brand-contrast": "#ffffff",
  "--color-accent": "#4338ca",
  "--color-focus": "#312e81",
} as CSSProperties;

// The platform site (D121): sells the platform and signs up shop owners.
// Reached only on PLATFORM_HOST (the proxy rewrites that host to here, and
// every page checks the host again).
export default async function PlatformSiteLayout({ children }: { children: ReactNode }) {
  await requirePlatformSite();
  const name = getEnv().PLATFORM_NAME;
  return (
    <div style={THEME} className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-control bg-brand text-sm font-bold text-brand-contrast"
            >
              {name.slice(0, 1).toUpperCase()}
            </span>
            {name}
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-4">
            <Link href="/#features" className="hidden px-2 py-2 hover:text-brand md:inline">
              Features
            </Link>
            <Link href="/templates" className="hidden px-2 py-2 hover:text-brand sm:inline">
              Templates
            </Link>
            <Link href="/#pricing" className="hidden px-2 py-2 hover:text-brand md:inline">
              Pricing
            </Link>
            <Link href="/admin/sign-in" className="px-2 py-2 hover:text-brand">
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses("primary", "min-h-9 px-3")}>
              Start free trial
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {name}. Made in Lebanon.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <Link href="/templates" className="hover:text-ink">
              Templates
            </Link>
            <Link href="/signup" className="hover:text-ink">
              Start free trial
            </Link>
            <Link href="/admin/sign-in" className="hover:text-ink">
              Shop owner sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
