import { listTopCategories } from "@ecom/core";
import { buttonClasses, inputClasses } from "@ecom/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { storefrontDb } from "@/server/storefront";

// Storefront shell: header with search and category navigation, main, footer.
// The store comes from the host name.
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const { store, db } = await storefrontDb();
  const categories = await listTopCategories(db);

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight" data-testid="store-name">
            {store.name}
          </Link>
          <form
            action="/search"
            method="get"
            role="search"
            className="flex w-full items-center gap-2 sm:w-auto sm:flex-1 sm:justify-end"
          >
            <label htmlFor="site-search" className="sr-only">
              Search products
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="Search products"
              maxLength={100}
              className={`${inputClasses} sm:max-w-xs`}
            />
            <button type="submit" className={buttonClasses("secondary")}>
              Search
            </button>
          </form>
        </div>
        {/* Scrolls sideways inside itself on small screens; the page never does. */}
        <nav aria-label="Shop" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2 text-sm whitespace-nowrap">
            <li>
              <Link
                href="/products"
                className="flex min-h-11 items-center rounded-control px-3 font-medium hover:bg-surface-muted"
              >
                Shop all
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  className="flex min-h-11 items-center rounded-control px-3 text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        {children}
      </main>
      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-ink-muted">
          <span>
            © {new Date().getFullYear()} {store.name}
          </span>
        </div>
      </footer>
    </div>
  );
}
