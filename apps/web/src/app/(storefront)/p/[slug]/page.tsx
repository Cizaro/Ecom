import { getPublicProduct } from "@ecom/core";
import type { Metadata } from "next";
import { MediaImage } from "@/components/media-image";
import { viewOf } from "@/server/media";
import { publicOrNotFound, storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { Price } from "../../_components/product-card";

// A first version of the product page, so that product cards lead somewhere:
// pictures, price, description and specifications. The gallery, choosing a
// variant, stock status, add to cart and related products come in
// Milestones 2.4 and 2.5.

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { db } = await storefrontDb();
  const product = await publicOrNotFound(getPublicProduct(db, (await params).slug));
  return {
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? (product.shortDescription || undefined),
  };
}

export default async function ProductPage({ params }: Props) {
  const { db } = await storefrontDb();
  const product = await publicOrNotFound(getPublicProduct(db, (await params).slug));
  const cheapest = product.variants.reduce((low, variant) =>
    variant.priceAmount < low.priceAmount ? variant : low,
  );
  const priceVaries = product.variants.some(
    (variant) => variant.priceAmount !== cheapest.priceAmount,
  );
  const colors = [...new Set(product.variants.map((variant) => variant.color).filter(Boolean))];
  const sizes = [...new Set(product.variants.map((variant) => variant.size).filter(Boolean))];
  const details = [
    ...(product.material ? [{ key: "Material", value: product.material }] : []),
    ...(colors.length > 0 ? [{ key: "Colours", value: colors.join(", ") }] : []),
    ...(sizes.length > 0 ? [{ key: "Sizes", value: sizes.join(", ") }] : []),
    ...product.attributes,
  ];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        trail={[
          { name: "Home", href: "/" },
          ...(product.category
            ? [{ name: product.category.name, href: `/c/${product.category.slug}` }]
            : []),
        ]}
        current={product.name}
      />
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {product.images.length > 0 ? (
            product.images.map((item, index) => (
              <MediaImage
                key={item.image.assetId}
                image={viewOf(item.image)}
                alt={item.altText}
                sizes="(min-width: 768px) 50vw, 100vw"
                priority={index === 0}
                className="w-full rounded-card"
              />
            ))
          ) : (
            <div
              aria-hidden="true"
              className="flex aspect-[4/5] items-center justify-center rounded-card bg-surface-muted text-sm text-ink-subtle"
            >
              No photo yet
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            {product.brandName ? (
              <p className="text-sm tracking-wide text-ink-muted uppercase">{product.brandName}</p>
            ) : null}
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
          </div>
          <div className="text-lg">
            <Price
              amount={cheapest.priceAmount}
              regularAmount={cheapest.regularPriceAmount}
              currency={cheapest.currency}
              from={priceVaries}
            />
          </div>
          {product.shortDescription ? (
            <p className="text-ink-muted">{product.shortDescription}</p>
          ) : null}
          {product.description ? (
            <p className="max-w-prose whitespace-pre-line">{product.description}</p>
          ) : null}
          {details.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
              {details.map((detail) => (
                <div key={detail.key} className="contents">
                  <dt className="font-medium">{detail.key}</dt>
                  <dd className="text-ink-muted">{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {product.careInfo ? (
            <div className="border-t border-line pt-4 text-sm">
              <h2 className="font-medium">Care</h2>
              <p className="mt-1 whitespace-pre-line text-ink-muted">{product.careInfo}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
