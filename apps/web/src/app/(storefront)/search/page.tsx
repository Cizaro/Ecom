import { searchTerms } from "@ecom/core";
import { EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import type { RawParams } from "@/server/listing";
import { shopT } from "@/server/i18n";
import { listingState } from "@/server/listing-page";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { ProductListing } from "../_components/listing";

// Search result pages are endless variations of the same lists: keep them out
// of search engines.
export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Search"), robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const [{ store, db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const state = listingState("/search", await searchParams, { search: true });
  const hasWords = searchTerms(state.q).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ name: t("Home"), href: "/" }]} current={t("Search")} />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="search-title">
        {hasWords ? t("Results for “{query}”", { query: state.q }) : t("Search")}
      </h1>
      {hasWords ? (
        <ProductListing
          db={db}
          basePath="/search"
          state={state}
          currency={store.defaultCurrency}
          scope={{}}
          emptyTitle={t("Nothing found for “{query}”", { query: state.q })}
        />
      ) : (
        <EmptyState title={t("Type what you are looking for")}>
          {t("Use the search box at the top of the page: a product name, a material, a brand.")}
        </EmptyState>
      )}
    </div>
  );
}
