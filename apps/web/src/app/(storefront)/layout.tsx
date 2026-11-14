import { getCartCount, listTopCategories } from "@ecom/core";
import { buttonClasses, inputClasses } from "@ecom/ui";
import { getEnv } from "@ecom/config";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { readCartToken } from "@/server/cart";
import { storefrontDb, storefrontOrigin } from "@/server/storefront";

/**
 * Defaults for every shop page: the store's name in the title, absolute
 * addresses for link previews, and whether search engines may index at all.
 * A page that sets its own `robots` (search, cart, filtered lists) replaces
 * the default.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { store } = await storefrontDb();
  const allowIndexing = getEnv().ALLOW_SEARCH_INDEXING;
  return {
    metadataBase: new URL(await storefrontOrigin()),
    title: { default: store.name, template: `%s | ${store.name}` },
    openGraph: { siteName: store.name, type: "website" },
    robots: { index: allowIndexing, follow: allowIndexing },
  };
}

// Storefront shell: header with search and category navigation, main, footer.
// The store comes from the host name.
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const { store, db } = await storefrontDb();
  const cartToken = await readCartToken();
  const [categories, cartCount] = await Promise.all([
    listTopCategories(db),
    // No cookie, no query: most visitors never have a cart.
    cartToken ? getCartCount(db, cartToken) : 0,
  ]);

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
            className="order-3 flex w-full items-center gap-2 sm:order-2 sm:w-auto sm:flex-1 sm:justify-end"
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
          <Link
            href="/cart"
            // Beside the store name on phones, after the search box on wider screens.
            className="order-2 flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium hover:bg-surface-muted sm:order-3"
            data-testid="cart-link"
          >
            Cart
            <span
              className="rounded-full bg-brand px-2 py-0.5 text-xs text-brand-contrast"
              data-testid="cart-count"
            >
              {cartCount}
            </span>
            <span className="sr-only">{cartCount === 1 ? "item" : "items"}</span>
          </Link>
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
