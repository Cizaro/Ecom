import { searchTerms } from "@ecom/core";
import { EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import type { RawParams } from "@/server/listing";
import { listingState } from "@/server/listing-page";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { ProductListing } from "../_components/listing";

// Search result pages are endless variations of the same lists: keep them out
// of search engines.
export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const { store, db } = await storefrontDb();
  const state = listingState("/search", await searchParams, { search: true });
  const hasWords = searchTerms(state.q).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }]} current="Search" />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="search-title">
        {hasWords ? `Results for “${state.q}”` : "Search"}
      </h1>
      {hasWords ? (
        <ProductListing
          db={db}
          basePath="/search"
          state={state}
          currency={store.defaultCurrency}
          scope={{}}
          emptyTitle={`Nothing found for “${state.q}”`}
        />
      ) : (
        <EmptyState title="Type what you are looking for">
          Use the search box at the top of the page: a product name, a material, a brand.
        </EmptyState>
      )}
    </div>
  );
}
