import { describe, expect, it } from "vitest";
import { parseRecent, withRecent } from "./recently-viewed";
import {
  breadcrumbStructuredData,
  decimalAmount,
  jsonLdString,
  productStructuredData,
  type ProductData,
} from "./structured-data";

describe("recently viewed cookie", () => {
  it("puts the newest product first and lists each product once", () => {
    let value = withRecent(undefined, "tote");
    value = withRecent(value, "wallet");
    value = withRecent(value, "tote");
    expect(value).toBe("tote.wallet");
    expect(parseRecent(value)).toEqual(["tote", "wallet"]);
  });

  it("keeps a limited number", () => {
    let value = "";
    for (let index = 0; index < 30; index += 1) value = withRecent(value, `product-${index}`);
    const slugs = parseRecent(value);
    expect(slugs).toHaveLength(9);
    expect(slugs[0]).toBe("product-29");
  });

  it("drops anything that is not a URL name, since anyone can edit a cookie", () => {
    expect(
      parseRecent("tote.<script>.../../admin.UPPER.a b.%27.ok-1..-bad.bad-." + "x".repeat(200)),
    ).toEqual(["tote", "ok-1"]);
    expect(parseRecent("")).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("a.".repeat(5000)).length).toBeLessThanOrEqual(9);
  });
});

const product: ProductData = {
  name: "Classic Tote",
  description: "Roomy everyday tote.",
  url: "https://shop.example/p/classic-tote",
  images: ["https://media.example/a.jpg"],
  brandName: "Aria",
  categoryName: "Bags",
  variants: [
    {
      sku: "TOTE-BLK",
      priceAmount: 9000,
      currency: "USD",
      url: "https://shop.example/p/classic-tote",
    },
    {
      sku: "TOTE-TAN",
      priceAmount: 12050,
      currency: "USD",
      url: "https://shop.example/p/classic-tote?color=tan",
    },
  ],
  currencyExponent: 2,
};

describe("structured data", () => {
  it("writes amounts as decimals without rounding", () => {
    expect(decimalAmount(4990, 2)).toBe("49.90");
    expect(decimalAmount(5, 2)).toBe("0.05");
    expect(decimalAmount(100, 2)).toBe("1.00");
    expect(decimalAmount(1500, 0)).toBe("1500");
    expect(decimalAmount(1234567, 3)).toBe("1234.567");
  });

  it("describes a product with its real price range and nothing invented", () => {
    const data = productStructuredData(product);
    expect(data).toMatchObject({
      "@type": "Product",
      name: "Classic Tote",
      brand: { "@type": "Brand", name: "Aria" },
      offers: {
        "@type": "AggregateOffer",
        lowPrice: "90.00",
        highPrice: "120.50",
        priceCurrency: "USD",
        offerCount: 2,
      },
    });
    const text = JSON.stringify(data);
    // No stock claim, rating or review: the store has none to report.
    expect(text).not.toMatch(/availability|InStock|aggregateRating|review/i);
  });

  it("describes a single variant as one offer and leaves out what is missing", () => {
    const data = productStructuredData({
      ...product,
      description: "",
      images: [],
      brandName: null,
      categoryName: null,
      variants: [product.variants[0]!],
    });
    expect(data.offers).toEqual({
      "@type": "Offer",
      url: "https://shop.example/p/classic-tote",
      sku: "TOTE-BLK",
      price: "90.00",
      priceCurrency: "USD",
    });
    for (const key of ["description", "image", "brand", "category"]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("numbers the breadcrumb trail", () => {
    const data = breadcrumbStructuredData([
      { name: "Home", url: "https://shop.example/" },
      { name: "Bags", url: "https://shop.example/c/bags" },
    ]) as { itemListElement: { position: number; name: string }[] };
    expect(data.itemListElement.map((item) => [item.position, item.name])).toEqual([
      [1, "Home"],
      [2, "Bags"],
    ]);
  });

  it("cannot be broken out of by text a store wrote", () => {
    const hostile = {
      name: `</script><script>alert(1)</script>`,
      note: `a & b ${String.fromCharCode(0x2028)} c`,
    };
    const text = jsonLdString(hostile);
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).not.toContain("&");
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(text)).toEqual(hostile);
  });
});
