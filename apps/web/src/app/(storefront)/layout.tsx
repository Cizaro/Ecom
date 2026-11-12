import Link from "next/link";
import type { ReactNode } from "react";
import { requireStorefront } from "@/server/storefront";

// Storefront shell: header, main and footer around every shop page. The store
// comes from the host name; navigation and search arrive with the catalog.
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const store = await requireStorefront();

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight" data-testid="store-name">
            {store.name}
          </Link>
          <nav aria-label="Shop" className="text-sm text-ink-muted">
            <span>Bags · Wallets · Watches · Jewelry</span>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        {children}
      </main>
      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-ink-muted">
          <span>
            © {new Date().getFullYear()} {store.name}
          </span>
          <span>Secure checkout · Easy returns</span>
        </div>
      </footer>
    </div>
  );
}
