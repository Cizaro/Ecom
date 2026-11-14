import { activeFilterCount, listingHref, type ListingState } from "./listing";

// What search engines are told about a store: which pages they may read
// (robots.txt), which pages exist (sitemap.xml), and which address is the
// real one for a list that can be sorted, filtered and paged. Plain functions
// with no server-only imports, so they can be unit tested.

/** Parts of a store that are never useful in search results. */
export const PRIVATE_PATHS = ["/admin", "/api/", "/cart", "/search"] as const;

/**
 * The robots.txt of a store. While indexing is switched off (the default,
 * so a test or staging copy never ends up in search results) everything is
 * disallowed.
 */
export function robotsTxt(options: { allowIndexing: boolean; origin: string }): string {
  if (!options.allowIndexing) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${options.origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export interface SitemapEntry {
  path: string;
  lastModified?: Date;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]!);

/** The most addresses one sitemap file may list (the protocol's limit is 50,000). */
export const SITEMAP_LIMIT = 45_000;

export function sitemapXml(origin: string, entries: readonly SitemapEntry[]): string {
  const urls = entries.slice(0, SITEMAP_LIMIT).map((entry) => {
    const lastModified = entry.lastModified
      ? `<lastmod>${entry.lastModified.toISOString()}</lastmod>`
      : "";
    return `<url><loc>${escapeXml(`${origin}${entry.path}`)}</loc>${lastModified}</url>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
  );
}

export interface ListingSeo {
  /** The address search engines should treat as this list. */
  canonical: string;
  /** False for sorted, filtered or searched variations: countless near-copies of one list. */
  index: boolean;
}

/**
 * A plain list and each of its pages are worth indexing under their own
 * address. A sorted or filtered view is the same products in another order
 * or a subset: it points at the plain list and asks not to be indexed.
 */
export function listingSeo(basePath: string, state: ListingState): ListingSeo {
  const variation = activeFilterCount(state) > 0 || state.sort !== null || state.q !== "";
  if (variation) return { canonical: basePath, index: false };
  return {
    canonical: listingHref(basePath, { ...state, brands: [], colors: [], min: "", max: "" }),
    index: true,
  };
}
