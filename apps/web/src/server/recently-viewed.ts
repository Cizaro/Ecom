// "Recently viewed" is remembered in the visitor's browser as a cookie holding
// product URL names only. This file is shared by the browser code that writes
// the cookie and the server code that reads it, so it must stay free of
// server-only imports.

export const RECENT_COOKIE = "recent";
export const RECENT_COOKIE_DAYS = 30;
/** One more than is shown, because the product being viewed is left out. */
const MAX_REMEMBERED = 9;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The URL names in a cookie value, newest first. Anything that is not a
 * well-formed URL name is dropped: the value comes from the browser and can
 * be edited by anyone.
 */
export function parseRecent(value: string | undefined | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .slice(0, 2000)
        .split(".")
        .filter((slug) => slug.length <= 120 && SLUG.test(slug)),
    ),
  ].slice(0, MAX_REMEMBERED);
}

/** The cookie value after viewing `slug`: that product first, then the earlier ones. */
export function withRecent(value: string | undefined | null, slug: string): string {
  return parseRecent(`${slug}.${value ?? ""}`).join(".");
}
