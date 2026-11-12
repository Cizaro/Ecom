import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce, CSP_HEADER, NONCE_HEADER } from "./server/csp";
import { REQUEST_ID_HEADER, requestIdFrom } from "./server/request-id";

// Runs before every page and API request:
// - gives the request an ID, visible to server code (request header) and the
//   client (response header), for logs, the audit log and API errors;
// - creates a per-request nonce and the Content Security Policy that uses it.
//   Next.js reads the policy from the request headers and adds the nonce to
//   the scripts it renders.
export function proxy(request: NextRequest) {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const nonce = createNonce();
  // eslint-disable-next-line no-restricted-properties -- inlined at build time by Next.js
  const csp = buildCsp(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(CSP_HEADER, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set(CSP_HEADER, csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      // Prefetches are not rendered with a nonce; leave them alone.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
