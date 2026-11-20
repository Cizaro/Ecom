// Set on every request by the proxy (never taken from the client): which part
// of the site a page belongs to, and the page's path. Edge-safe: no imports.

export const AREA_HEADER = "x-ecom-area";
export const PATH_HEADER = "x-ecom-path";

/** "platform": the public site that sells the platform itself (D121). */
export type Area = "shop" | "admin" | "platform";

/** Staff pages and the API are always English; everything else is the shop. */
export function areaOf(pathname: string): Area {
  return /^\/(admin|api)(\/|$)/.test(pathname) ? "admin" : "shop";
}

/** Where the platform site's pages live inside the app (reached only through the rewrite). */
export const PLATFORM_SITE_PREFIX = "/platform-site";

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * The host name a request was made to, lowercase and without the port. Same
 * rule as storefrontRequestHost in @ecom/core: X-Forwarded-Host counts only
 * when the request itself came from this machine (Next.js after a server
 * action, or a reverse proxy on the same machine).
 */
export function requestHostName(
  host: string | null | undefined,
  forwardedHost: string | null | undefined,
): string | null {
  const direct = host?.trim() || null;
  const forwarded = forwardedHost?.split(",")[0]?.trim();
  const chosen = direct && LOOPBACK.test(direct) && forwarded ? forwarded : direct;
  if (!chosen || chosen.startsWith("[")) return null;
  return chosen.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "") || null;
}

/**
 * The path to render for a request to the platform's own host: its public
 * pages come from the platform-site folder; the admin, the API and Next.js
 * files are shared with every shop. Null when the request is not rewritten.
 */
export function platformRewrite(pathname: string): string | null {
  if (/^\/(admin|api|_next)(\/|$)/.test(pathname)) return null;
  return pathname === "/" ? PLATFORM_SITE_PREFIX : `${PLATFORM_SITE_PREFIX}${pathname}`;
}
