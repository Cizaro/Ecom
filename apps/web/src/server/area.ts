// Set on every request by the proxy (never taken from the client): which part
// of the site a page belongs to, and the page's path. Edge-safe: no imports.

export const AREA_HEADER = "x-ecom-area";
export const PATH_HEADER = "x-ecom-path";

export type Area = "shop" | "admin";

/** Staff pages and the API are always English; everything else is the shop. */
export function areaOf(pathname: string): Area {
  return /^\/(admin|api)(\/|$)/.test(pathname) ? "admin" : "shop";
}
