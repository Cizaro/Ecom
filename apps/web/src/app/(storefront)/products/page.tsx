import type { Metadata } from "next";
import type { RawParams } from "@/server/listing";
import { listingState } from "@/server/listing-page";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { ProductListing } from "../_components/listing";

export const metadata: Metadata = { title: "All products" };

export default async function AllProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { store, db } = await storefrontDb();
  const state = listingState("/products", await searchParams, { search: false });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }]} current="All products" />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">All products</h1>
      <ProductListing
        db={db}
        basePath="/products"
        state={state}
        currency={store.defaultCurrency}
        scope={{}}
        emptyTitle="Our shop is opening soon"
      />
    </div>
  );
}
