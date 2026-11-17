import { listPublishedPages, listSitemapSource } from "@ecom/core";
import { SITEMAP_LIMIT, sitemapXml, type SitemapEntry } from "@/server/seo";
import { storefrontDb, storefrontOrigin } from "@/server/storefront";

// The pages of this store that a shopper can open: home, all products,
// categories and published products. Built from the same public reads as the
// pages themselves, so a draft can never be listed.
export async function GET(): Promise<Response> {
  const { db } = await storefrontDb();
  const [origin, source, pages] = await Promise.all([
    storefrontOrigin(),
    listSitemapSource(db, SITEMAP_LIMIT),
    listPublishedPages(db),
  ]);
  const entries: SitemapEntry[] = [
    { path: "/" },
    { path: "/products" },
    ...pages.map((page) => ({ path: `/policies/${page.slug}` })),
    ...source.categories.map((category) => ({
      path: `/c/${category.slug}`,
      lastModified: category.updatedAt,
    })),
    ...source.products.map((product) => ({
      path: `/p/${product.slug}`,
      lastModified: product.updatedAt,
    })),
  ];
  return new Response(sitemapXml(origin, entries), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
