import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, requestIdFrom } from "./server/request-id";

// Gives every request an ID, visible to server code (request header) and to
// the client (response header), for logs, the audit log and API errors.
export function proxy(request: NextRequest) {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
