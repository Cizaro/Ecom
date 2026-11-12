export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Keeps a request ID supplied by a trusted proxy if it looks sane, otherwise
 * makes a new one. Never echoes arbitrary client text into logs or headers.
 */
export function requestIdFrom(incoming: string | null): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}
