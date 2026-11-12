export const SLUG_MAX_LENGTH = 120;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether a value can be used in a URL as-is. Mirrors the database check. */
export function isSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG.test(value);
}

/**
 * Turns a name into a URL name: "Crème Leather Tote!" becomes
 * "creme-leather-tote". Returns an empty string when the name has no Latin
 * letters or digits (for example a name written only in Arabic), in which
 * case the caller must ask for a URL name.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
}
