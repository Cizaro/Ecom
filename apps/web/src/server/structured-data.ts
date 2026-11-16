// Machine-readable descriptions of a page (schema.org JSON-LD) for search
// engines and link previews. Everything here is derived from what the page
// already shows; nothing is added that the page does not say (no ratings, and
// availability only for items whose stock is counted).

export interface ProductData {
  name: string;
  description: string;
  url: string;
  images: string[];
  brandName: string | null;
  categoryName: string | null;
  variants: {
    sku: string;
    priceAmount: number;
    currency: string;
    url: string;
    /** Leave out, or "untracked", when stock is not counted: nothing is claimed then. */
    stock?: "untracked" | "in_stock" | "low" | "out_of_stock";
  }[];
  /** Digits after the decimal point for the currency (2 for USD, 0 for JPY). */
  currencyExponent: number;
}

/** "4990" minor units -> "49.90". Text arithmetic only, so no rounding error. */
export function decimalAmount(amount: number, exponent: number): string {
  if (exponent === 0) return String(amount);
  const digits = String(amount).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

const AVAILABILITY = {
  in_stock: "https://schema.org/InStock",
  low: "https://schema.org/LimitedAvailability",
  out_of_stock: "https://schema.org/OutOfStock",
} as const;

/** For several variants: in stock if any is; claimed only when every variant is counted. */
function availabilityOf(stocks: ProductData["variants"][number]["stock"][]) {
  if (stocks.length === 0 || stocks.some((stock) => !stock || stock === "untracked")) return {};
  const status = stocks.includes("in_stock")
    ? "in_stock"
    : stocks.includes("low")
      ? "low"
      : "out_of_stock";
  return { availability: AVAILABILITY[status] };
}

export function productStructuredData(product: ProductData): Record<string, unknown> {
  const prices = product.variants.map((variant) => variant.priceAmount);
  const currency = product.variants[0]?.currency;
  const price = (amount: number) => decimalAmount(amount, product.currencyExponent);
  const offers =
    product.variants.length === 1
      ? {
          "@type": "Offer",
          url: product.variants[0]!.url,
          sku: product.variants[0]!.sku,
          price: price(prices[0]!),
          priceCurrency: currency,
          ...availabilityOf([product.variants[0]!.stock]),
        }
      : {
          "@type": "AggregateOffer",
          url: product.url,
          lowPrice: price(Math.min(...prices)),
          highPrice: price(Math.max(...prices)),
          priceCurrency: currency,
          offerCount: product.variants.length,
          ...availabilityOf(product.variants.map((variant) => variant.stock)),
        };
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    url: product.url,
    ...(product.images.length > 0 ? { image: product.images } : {}),
    ...(product.brandName ? { brand: { "@type": "Brand", name: product.brandName } } : {}),
    ...(product.categoryName ? { category: product.categoryName } : {}),
    ...(product.variants.length > 0 ? { offers } : {}),
  };
}

export function breadcrumbStructuredData(
  trail: readonly { name: string; url: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: step.url,
    })),
  };
}

/** Line and paragraph separators: valid in JSON, but they end a line in older script parsers. */
const SEPARATORS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g");

/**
 * JSON for a <script type="application/ld+json"> element. Store staff write
 * product names and descriptions, so the characters that could end the
 * script element or start markup are escaped.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(SEPARATORS, (char) => "\\u" + char.charCodeAt(0).toString(16));
}
