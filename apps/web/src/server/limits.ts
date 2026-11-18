import "server-only";

import { getEnv } from "@ecom/config";
import { createRedisRateLimiter, type RateLimiter, type RateLimitRule } from "@ecom/core";
import { headers } from "next/headers";
import { clientAddressFrom } from "./client-address";

// Limits on what a visitor may do without signing in (launch hardening).
// Each purpose has its own counter per store and visitor address, sized to
// what a real shopper needs: placing orders holds stock, so it is tight;
// discount codes could be guessed, so checks are limited; the contact form
// alerts staff, so new conversations are few.

export const VISITOR_LIMITS = {
  cart: { limit: 60, windowSeconds: 60 },
  order: { limit: 5, windowSeconds: 10 * 60 },
  payment: { limit: 20, windowSeconds: 10 * 60 },
  discount: { limit: 20, windowSeconds: 10 * 60 },
  contact: { limit: 5, windowSeconds: 60 * 60 },
  reply: { limit: 30, windowSeconds: 60 * 60 },
  review: { limit: 10, windowSeconds: 60 * 60 },
  report: { limit: 20, windowSeconds: 60 * 60 },
  photo: { limit: 10, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type VisitorAction = keyof typeof VISITOR_LIMITS;

const globalForLimits = globalThis as typeof globalThis & { __visitorLimiter?: RateLimiter };

/** The visitor's address, as far as the configured proxies can vouch for it. */
export async function visitorAddress(): Promise<string> {
  return clientAddressFrom((await headers()).get("x-forwarded-for"), getEnv().TRUST_PROXY_HOPS);
}

/**
 * Counts one attempt and says whether this visitor has made too many. If the
 * counter is unreachable the attempt is allowed: a shopper should not be
 * locked out because Redis is down.
 */
export async function tooManyAttempts(tenantId: string, action: VisitorAction): Promise<boolean> {
  globalForLimits.__visitorLimiter ??= createRedisRateLimiter(getEnv().REDIS_URL);
  const base = VISITOR_LIMITS[action];
  const rule = { ...base, limit: base.limit * getEnv().RATE_LIMIT_SCALE };
  try {
    const status = await globalForLimits.__visitorLimiter.hit(
      `visitor:${action}:${tenantId}:${await visitorAddress()}`,
      rule,
    );
    return status.count > rule.limit;
  } catch {
    return false;
  }
}
