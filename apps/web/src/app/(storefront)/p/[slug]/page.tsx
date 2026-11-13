import {
  currencyExponent,
  getPublicProduct,
  listPublicProductsBySlug,
  listRelatedProducts,
  selectVariant,
  type PublicProduct,
  type PublicVariant,
} from "@ecom/core";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { viewOf } from "@/server/media";
import { parseRecent, RECENT_COOKIE } from "@/server/recently-viewed";
import { publicOrNotFound, storefrontDb, storefrontOrigin } from "@/server/storefront";
import {
  breadcrumbStructuredData,
  jsonLdString,
  productStructuredData,
} from "@/server/structured-data";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { Price, ProductGrid } from "../../_components/product-card";
import { RememberProduct, ShareButton } from "../../_components/product-extras";
import { ProductGallery } from "../../_components/product-gallery";
import { VariantPicker } from "../../_components/variant-picker";

// The product page. The chosen colour and size are in the page address
// (?color=tan&size=m), so choosing works without JavaScript and a link to a
// particular variant can be shared. Nothing is said about stock until stock
// is tracked (Milestone 3.2); add to cart arrives with the cart (2.5).

type Params = Record<string, string | string[] | undefined>;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Params>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The address of the page with this variant chosen. The default variant has the plain address. */
function variantPath(product: PublicProduct, variant: PublicVariant): string {
  const path = `/p/${product.slug}`;
  if (variant.id === product.variants[0]?.id) return path;
  const query = new URLSearchParams();
  if (variant.color) query.set("color", variant.color.trim().toLowerCase());
  if (variant.size) query.set("size", variant.size.trim().toLowerCase());
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { db } = await storefrontDb();
  const product = await publicOrNotFound(getPublicProduct(db, (await params).slug));
  const origin = await storefrontOrigin();
  const title = product.seoTitle ?? product.name;
  const description = product.seoDescription ?? (product.shortDescription || undefined);
  const image = product.images[0] ? viewOf(product.images[0].image).url : undefined;
  return {
    title,
    description,
    metadataBase: new URL(origin),
    // Every colour and size is the same page for search engines.
    alternates: { canonical: `/p/${product.slug}` },
    openGraph: {
      title,
      description,
      url: `/p/${product.slug}`,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { db } = await storefrontDb();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const product = await publicOrNotFound(getPublicProduct(db, slug));

  const selection = selectVariant(product.variants, {
    color: first(query.color),
    size: first(query.size),
  });
  const variant = selection.variant;
  const variantById = new Map(product.variants.map((item) => [item.id, item]));
  const hrefFor = (variantId: string) => variantPath(product, variantById.get(variantId)!);

  // Pictures of the chosen variant first, then the ones that show the product
  // in general. Pictures of other variants are left out.
  const own = product.images.filter((item) => item.variantId === variant.id);
  const general = product.images.filter((item) => item.variantId === null);
  const shown = own.length + general.length > 0 ? [...own, ...general] : product.images;
  const pictures = shown.map((item) => ({
    id: item.image.assetId,
    alt: item.altText,
    image: viewOf(item.image),
  }));

  const recentSlugs = parseRecent((await cookies()).get(RECENT_COOKIE)?.value).filter(
    (recent) => recent !== product.slug,
  );
  const [related, recent, origin] = await Promise.all([
    listRelatedProducts(db, { id: product.id, categoryId: product.category?.id ?? null }),
    listPublicProductsBySlug(db, recentSlugs),
    storefrontOrigin(),
  ]);

  const details = [
    ...(product.material ? [{ key: "Material", value: product.material }] : []),
    ...product.attributes,
  ];
  const trail = [
    { name: "Home", href: "/" },
    ...(product.category
      ? [{ name: product.category.name, href: `/c/${product.category.slug}` }]
      : []),
  ];
  const structuredData = [
    productStructuredData({
      name: product.name,
      description: product.shortDescription || product.description,
      url: `${origin}/p/${product.slug}`,
      images: product.images.map((item) => viewOf(item.image).url),
      brandName: product.brandName,
      categoryName: product.category?.name ?? null,
      variants: product.variants.map((item) => ({
        sku: item.sku,
        priceAmount: item.priceAmount,
        currency: item.currency,
        url: `${origin}${variantPath(product, item)}`,
      })),
      currencyExponent: currencyExponent(variant.currency),
    }),
    breadcrumbStructuredData([
      ...trail.map((step) => ({ name: step.name, url: `${origin}${step.href}` })),
      { name: product.name, url: `${origin}/p/${product.slug}` },
    ]),
  ];

  return (
    <div className="flex flex-col gap-12">
      {structuredData.map((data, index) => (
        // A data block, not code: the browser never runs it. Its content is
        // escaped by jsonLdString.
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
        />
      ))}
      <RememberProduct slug={product.slug} />

      <div className="flex flex-col gap-6">
        <Breadcrumbs trail={trail} current={product.name} />
        <div className="grid gap-8 md:grid-cols-2">
          {pictures.length > 0 ? (
            // A new key per variant returns the gallery to its first picture.
            <ProductGallery key={variant.id} pictures={pictures} />
          ) : (
            <div
              aria-hidden="true"
              className="flex aspect-[4/5] items-center justify-center rounded-card bg-surface-muted text-sm text-ink-subtle"
            >
              No photo yet
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-5">
            <div>
              {product.brandName ? (
                <p className="text-sm tracking-wide text-ink-muted uppercase">
                  {product.brandName}
                </p>
              ) : null}
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
            </div>
            <div className="text-xl">
              <Price
                amount={variant.priceAmount}
                regularAmount={variant.regularPriceAmount}
                currency={variant.currency}
              />
            </div>
            {product.shortDescription ? (
              <p className="text-ink-muted">{product.shortDescription}</p>
            ) : null}

            <VariantPicker
              colors={selection.colors}
              sizes={selection.sizes}
              hrefFor={hrefFor}
              selectedColor={variant.color}
            />
            <p className="text-sm text-ink-muted" data-testid="sku">
              SKU: {variant.sku}
            </p>
            <ShareButton title={product.name} />

            {product.description ? (
              <div className="border-t border-line pt-5">
                <h2 className="font-medium">Description</h2>
                <p className="mt-2 max-w-prose whitespace-pre-line text-ink-muted">
                  {product.description}
                </p>
              </div>
            ) : null}
            {details.length > 0 ? (
              <div className="border-t border-line pt-5">
                <h2 className="font-medium">Details</h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  {details.map((detail) => (
                    <div key={detail.key} className="contents">
                      <dt className="font-medium">{detail.key}</dt>
                      <dd className="text-ink-muted">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {product.careInfo ? (
              <div className="border-t border-line pt-5">
                <h2 className="font-medium">Care</h2>
                <p className="mt-2 text-sm whitespace-pre-line text-ink-muted">
                  {product.careInfo}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {related.length > 0 && product.category ? (
        <section
          aria-labelledby="related"
          className="flex flex-col gap-4"
          data-testid="related-products"
        >
          <h2 id="related" className="text-xl font-semibold tracking-tight">
            More from {product.category.name}
          </h2>
          <ProductGrid products={related} />
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section
          aria-labelledby="recent"
          className="flex flex-col gap-4"
          data-testid="recently-viewed"
        >
          <h2 id="recent" className="text-xl font-semibold tracking-tight">
            Recently viewed
          </h2>
          <ProductGrid products={recent.slice(0, 4)} />
        </section>
      ) : null}
    </div>
  );
}
