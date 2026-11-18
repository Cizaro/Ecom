import "server-only";

import { getEnv } from "@ecom/config";
import { CART_LIFETIME_DAYS, isCartToken } from "@ecom/core";
import { cookies } from "next/headers";
import { tooManyAttempts } from "./limits";

// The visitor's cart token. It lives in a cookie the page's scripts cannot
// read (HttpOnly), is sent only to this site, and is strictly necessary for
// the cart to work, so it needs no consent.

export const CART_COOKIE = "cart";

/** The token from the request, or null when there is none or it is malformed. */
export async function readCartToken(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return isCartToken(value) ? value : null;
}

/** Gives the browser its cart token. Only callable from a server action or route handler. */
export async function writeCartToken(token: string): Promise<void> {
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(getEnv().APP_URL).protocol === "https:",
    path: "/",
    maxAge: CART_LIFETIME_DAYS * 24 * 60 * 60,
  });
}

/** Counts one cart change; true when this visitor has made too many (see limits.ts). */
export async function tooManyCartChanges(tenantId: string): Promise<boolean> {
  return tooManyAttempts(tenantId, "cart");
}
