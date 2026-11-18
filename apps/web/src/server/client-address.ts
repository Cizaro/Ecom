// The visitor's address for rate limits (launch hardening). X-Forwarded-For
// is a list each proxy appends to; everything left of what our own proxies
// added can be written by the visitor. So the trusted entry is the one
// `hops` places from the right, never the first. With no proxy (hops 0) the
// header is ignored entirely.

export function clientAddressFrom(forwardedFor: string | null | undefined, hops: number): string {
  if (hops <= 0 || !forwardedFor) return "unknown";
  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const chosen = entries[entries.length - hops] ?? entries[0];
  // An address is short and plain; anything else is not trusted as a key.
  return chosen && /^[0-9a-fA-F:.]{2,45}$/.test(chosen) ? chosen : "unknown";
}
