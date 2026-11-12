// Content Security Policy. Scripts run only if they carry this request's
// nonce (Next.js adds it to its own scripts) or are loaded by such a script
// ('strict-dynamic'); inline event handlers and injected <script> tags are
// blocked. Styles allow 'unsafe-inline' because React and Next.js set inline
// styles; style injection cannot run code.

export const NONCE_HEADER = "x-nonce";
export const CSP_HEADER = "Content-Security-Policy";

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** The origin of an address, or null when it is missing or not a web address. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(
  nonce: string,
  options: {
    development: boolean;
    /** Where uploaded images are served from (the storage service or its CDN). */
    mediaOrigin?: string | null;
  },
): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // React's development build needs eval for its debugging features.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(options.development ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // data: for the two-factor QR code; blob: for previews of a chosen file.
    "img-src": ["'self'", "data:", "blob:", ...(options.mediaOrigin ? [options.mediaOrigin] : [])],
    "font-src": ["'self'"],
    // Development hot reload uses a websocket to the dev server.
    "connect-src": ["'self'", ...(options.development ? ["ws:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
