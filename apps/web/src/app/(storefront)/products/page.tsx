import type { Metadata } from "next";
import { parseListing, type RawParams } from "@/server/listing";
import { listingState } from "@/server/listing-page";
import { listingSeo } from "@/server/seo";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { ProductListing } from "../_components/listing";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}): Promise<Metadata> {
  const seo = listingSeo("/products", parseListing(await searchParams));
  return {
    title: "All products",
    alternates: { canonical: seo.canonical },
    ...(seo.index ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title: "All products", url: seo.canonical },
  };
}

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
