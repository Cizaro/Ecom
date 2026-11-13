import "server-only";

import { getEnv } from "@ecom/config";
import {
  CART_LIFETIME_DAYS,
  createRedisRateLimiter,
  isCartToken,
  type RateLimiter,
} from "@ecom/core";
import { cookies, headers } from "next/headers";

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

const globalForCart = globalThis as typeof globalThis & { __cartLimiter?: RateLimiter };

/** Cart changes allowed per visitor address per minute, per store. */
const CART_CHANGE_RULE = { limit: 60, windowSeconds: 60 };

/**
 * Counts one cart change and says whether this address has made too many.
 * If the counter itself is unreachable the change is allowed: a shopper
 * should not lose their cart because Redis is down.
 */
export async function tooManyCartChanges(tenantId: string): Promise<boolean> {
  globalForCart.__cartLimiter ??= createRedisRateLimiter(getEnv().REDIS_URL);
  // Trustworthy only behind a proxy that overwrites this header (see server/auth.ts).
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    const status = await globalForCart.__cartLimiter.hit(
      `cart:${tenantId}:${ip}`,
      CART_CHANGE_RULE,
    );
    return status.count > CART_CHANGE_RULE.limit;
  } catch {
    return false;
  }
}
