import { formatMoney, type PublicProductCard } from "@ecom/core";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { viewOf } from "@/server/media";

const GRID_SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

/** A price, with the regular price struck through when the item is on sale. */
export function Price({
  amount,
  regularAmount,
  currency,
  from = false,
}: {
  amount: number;
  regularAmount: number | null;
  currency: string;
  from?: boolean;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2" data-testid="price">
      <span className="font-medium">
        {from ? <span className="font-normal text-ink-muted">from </span> : null}
        {regularAmount !== null ? <span className="sr-only">Sale price </span> : null}
        {formatMoney(amount, currency)}
      </span>
      {regularAmount !== null ? (
        <s className="text-sm text-ink-muted">
          <span className="sr-only">Regular price </span>
          {formatMoney(regularAmount, currency)}
        </s>
      ) : null}
    </p>
  );
}

export function ProductCard({
  product,
  priority = false,
}: {
  product: PublicProductCard;
  priority?: boolean;
}) {
  const label = product.regularPriceAmount !== null ? "Sale" : product.isNewArrival ? "New" : null;
  return (
    <article data-testid="product-card" className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface-muted">
        {product.image ? (
          <MediaImage
            image={viewOf(product.image)}
            alt={product.image.altText}
            sizes={GRID_SIZES}
            priority={priority}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-full items-center justify-center text-sm text-ink-subtle"
          >
            No photo yet
          </div>
        )}
        {label ? (
          <span className="absolute top-2 left-2 rounded-control bg-surface px-2 py-1 text-xs font-medium">
            {label}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        {product.brandName ? (
          <p className="truncate text-xs tracking-wide text-ink-muted uppercase">
            {product.brandName}
          </p>
        ) : null}
        <h3 className="text-sm font-medium sm:text-base">
          {/* The link covers the whole card, so the picture is clickable too. */}
          <Link
            href={`/p/${product.slug}`}
            className="underline-offset-4 after:absolute after:inset-0 group-hover:underline"
          >
            {product.name}
          </Link>
        </h3>
        <Price
          amount={product.priceAmount}
          regularAmount={product.regularPriceAmount}
          currency={product.currency}
          from={product.priceVaries}
        />
        {product.colors.length > 1 ? (
          <p className="text-xs text-ink-muted">{product.colors.length} colours</p>
        ) : null}
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  priorityCount = 0,
}: {
  products: readonly PublicProductCard[];
  /** How many of the first cards are likely visible without scrolling. */
  priorityCount?: number;
}) {
  return (
    <ul
      data-testid="product-grid"
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
    >
      {products.map((product, index) => (
        <li key={product.id} className="min-w-0">
          <ProductCard product={product} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
