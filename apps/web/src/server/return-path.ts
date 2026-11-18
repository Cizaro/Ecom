/** Control characters, spaces and DEL: none belongs in a path we redirect to. */
const hasControlOrSpace = (value: string) =>
  [...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });

/**
 * Where to go after signing in. Only a path on this site is accepted, so a
 * crafted link cannot send a shopper to another site after they sign in.
 */
export function safeReturnPath(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || value.length > 300) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // Browsers drop tabs and line breaks from addresses, so "/<tab>/evil.example"
  // would become "//evil.example".
  if (hasControlOrSpace(value)) return fallback;
  if (/^\/(admin|api)(\/|$)/.test(value)) return fallback;
  return value;
}
