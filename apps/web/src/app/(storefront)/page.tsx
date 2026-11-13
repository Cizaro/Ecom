import { loadHomeSections, type PublicProductCard } from "@ecom/core";
import { buttonClasses } from "@ecom/ui";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { viewOf } from "@/server/media";
import { storefrontDb } from "@/server/storefront";
import { ProductGrid } from "./_components/product-card";

const SECTION_SIZE = 8;

function Section({
  title,
  products,
  priorityCount,
}: {
  title: string;
  products: readonly PublicProductCard[];
  priorityCount?: number;
}) {
  if (products.length === 0) return null;
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4" data-testid={id}>
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <ProductGrid products={products} priorityCount={priorityCount} />
    </section>
  );
}

// Storefront home: categories, then products the store has chosen to feature,
// marked as new, or marked as best sellers. Every section is real catalog
// data; a section with nothing in it is left out.
export default async function StorefrontHomePage() {
  const { store, db } = await storefrontDb();
  const { categories, featured, newArrivals, bestSellers, latest } = await loadHomeSections(
    db,
    SECTION_SIZE,
  );
  const hasProducts = featured.length + newArrivals.length + bestSellers.length + latest.length > 0;

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{store.name}</h1>
        <p className="max-w-prose text-ink-muted">
          {hasProducts
            ? "Bags, wallets, watches, jewelry and accessories."
            : "Our shop is opening soon. Bags, wallets, watches, jewelry and accessories."}
        </p>
        {hasProducts ? (
          <Link href="/products" className={buttonClasses()}>
            Shop all products
          </Link>
        ) : null}
      </section>

      {categories.length > 0 ? (
        <section aria-labelledby="home-categories" className="flex flex-col gap-4">
          <h2 id="home-categories" className="text-xl font-semibold tracking-tight">
            Shop by category
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((category) => (
              <li key={category.id} className="min-w-0">
                <Link
                  href={`/c/${category.slug}`}
                  className="group flex flex-col gap-2"
                  data-testid="category-tile"
                >
                  <div className="aspect-square overflow-hidden rounded-card bg-surface-muted">
                    {category.image ? (
                      <MediaImage
                        image={viewOf(category.image)}
                        alt=""
                        sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : null}
                  </div>
                  <span className="text-sm font-medium underline-offset-4 group-hover:underline">
                    {category.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section title="Featured" products={featured} priorityCount={4} />
      <Section title="New arrivals" products={newArrivals} />
      <Section title="Best sellers" products={bestSellers} />
      {/* When nothing is flagged yet, the newest products keep the page from being empty. */}
      <Section title="Latest additions" products={latest} priorityCount={4} />
    </div>
  );
}
