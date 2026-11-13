import { getPublicCategory } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { RawParams } from "@/server/listing";
import { listingState } from "@/server/listing-page";
import { publicOrNotFound, storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { ProductListing } from "../../_components/listing";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawParams>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { db } = await storefrontDb();
  const category = await publicOrNotFound(getPublicCategory(db, (await params).slug));
  return {
    title: category.seoTitle ?? category.name,
    description: category.seoDescription ?? (category.description || undefined),
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { store, db } = await storefrontDb();
  const { slug } = await params;
  const category = await publicOrNotFound(getPublicCategory(db, slug));
  const state = listingState(`/c/${category.slug}`, await searchParams, { search: false });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        trail={[
          { name: "Home", href: "/" },
          ...category.ancestors.map((ancestor) => ({
            name: ancestor.name,
            href: `/c/${ancestor.slug}`,
          })),
        ]}
        current={category.name}
      />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{category.name}</h1>
        {category.description ? (
          <p className="mt-2 max-w-prose text-ink-muted">{category.description}</p>
        ) : null}
      </div>

      {category.children.length > 0 ? (
        <nav aria-label={`Inside ${category.name}`}>
          <ul className="flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/c/${child.slug}`}
                  className="flex min-h-11 items-center rounded-control border border-line-strong px-4 text-sm hover:bg-surface-muted"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <ProductListing
        db={db}
        basePath={`/c/${category.slug}`}
        state={state}
        currency={store.defaultCurrency}
        scope={{ categoryId: category.id }}
        emptyTitle="Nothing in this category yet"
      />
    </div>
  );
}
