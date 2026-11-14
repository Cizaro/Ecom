import { describe, expect, it } from "vitest";
import { parseListing } from "./listing";
import { listingSeo, robotsTxt, SITEMAP_LIMIT, sitemapXml } from "./seo";

describe("robots.txt", () => {
  it("keeps everything out of search engines until indexing is switched on", () => {
    expect(robotsTxt({ allowIndexing: false, origin: "https://shop.example" })).toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });

  it("opens the shop but not the admin, the API, carts or search results", () => {
    const text = robotsTxt({ allowIndexing: true, origin: "https://shop.example" });
    const lines = text.split("\n");
    expect(lines).toContain("Allow: /");
    for (const path of ["/admin", "/api/", "/cart", "/search"]) {
      expect(lines).toContain(`Disallow: ${path}`);
    }
    expect(lines).not.toContain("Disallow: /");
    expect(lines).toContain("Sitemap: https://shop.example/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("lists full addresses with the date each page last changed", () => {
    const xml = sitemapXml("https://shop.example", [
      { path: "/" },
      { path: "/p/classic-tote", lastModified: new Date("2026-11-01T10:00:00Z") },
    ]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<url><loc>https://shop.example/</loc></url>");
    expect(xml).toContain(
      "<url><loc>https://shop.example/p/classic-tote</loc><lastmod>2026-11-01T10:00:00.000Z</lastmod></url>",
    );
  });

  it("escapes characters that would break the document", () => {
    const xml = sitemapXml("https://shop.example", [{ path: `/c/a&b<c>"d'` }]);
    expect(xml).toContain("<loc>https://shop.example/c/a&amp;b&lt;c&gt;&quot;d&apos;</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });

  it("never lists more than one file may hold", () => {
    const many = Array.from({ length: SITEMAP_LIMIT + 10 }, (_, index) => ({
      path: `/p/item-${index}`,
    }));
    expect(sitemapXml("https://shop.example", many).match(/<url>/g)).toHaveLength(SITEMAP_LIMIT);
  });
});

describe("which address stands for a list", () => {
  it("indexes the plain list and each of its pages under their own address", () => {
    expect(listingSeo("/c/bags", parseListing({}))).toEqual({ canonical: "/c/bags", index: true });
    expect(listingSeo("/c/bags", parseListing({ page: "3" }))).toEqual({
      canonical: "/c/bags?page=3",
      index: true,
    });
  });

  it("points sorted, filtered and searched views at the plain list, unindexed", () => {
    const variations = [
      { sort: "price_asc" },
      { color: "black" },
      { brand: "aria", page: "2" },
      { min: "10" },
      { max: "50", sort: "name" },
      { q: "tote" },
    ];
    for (const params of variations) {
      expect(listingSeo("/c/bags", parseListing(params)), JSON.stringify(params)).toEqual({
        canonical: "/c/bags",
        index: false,
      });
    }
  });
});
