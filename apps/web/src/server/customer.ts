import "server-only";

import { getEnv } from "@ecom/config";
import {
  createEmailProvider,
  createLogger,
  createRedisRateLimiter,
  CUSTOMER_SESSION_DAYS,
  getSessionCustomer,
  type CartOwner,
  type CustomerDeps,
  type CustomerProfile,
  type CustomerRequest,
  type EmailProvider,
  type RateLimiter,
} from "@ecom/core";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { CART_COOKIE, readCartToken } from "./cart";
import { shopLocale } from "./i18n";
import { storefrontDb, storefrontOrigin } from "./storefront";

// A shopper's account session. Customers are not staff: their cookie has its
// own name, is checked against the customer tables of this store only, and
// opens nothing in the admin.

export const CUSTOMER_COOKIE = "customer_session";
export const CUSTOMER_SIGN_IN_PATH = "/account/sign-in";

export async function readCustomerSessionToken(): Promise<string | null> {
  return (await cookies()).get(CUSTOMER_COOKIE)?.value ?? null;
}

/** Only callable from a server action or route handler. */
export async function writeCustomerSession(token: string): Promise<void> {
  (await cookies()).set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(getEnv().APP_URL).protocol === "https:",
    path: "/",
    maxAge: CUSTOMER_SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearCustomerSession(): Promise<void> {
  (await cookies()).delete(CUSTOMER_COOKIE);
}

/** After sign-in the guest cart has been claimed; its token opens nothing any more. */
export async function clearCartCookie(): Promise<void> {
  (await cookies()).delete(CART_COOKIE);
}

/** The signed-in customer of this store, or null. Checked once per request. */
export const getCurrentCustomer = cache(async (): Promise<CustomerProfile | null> => {
  const token = await readCustomerSessionToken();
  if (!token) return null;
  const { db } = await storefrontDb();
  return getSessionCustomer(db, token);
});

/** For account pages and actions: sends a signed-out visitor to sign in, then back. */
export async function requireCustomer(returnTo: string): Promise<CustomerProfile> {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(`${CUSTOMER_SIGN_IN_PATH}?next=${encodeURIComponent(returnTo)}`);
  return customer;
}

/** Whose cart this request is about: the signed-in customer's, or the guest cookie's. */
export async function cartOwner(): Promise<CartOwner> {
  const customer = await getCurrentCustomer();
  if (customer) return { customerId: customer.id };
  return { token: await readCartToken() };
}

/**
 * Where to go after signing in. Only a path on this site is accepted, so a
 * crafted link cannot send a shopper to another site after they sign in.
 */
export function safeReturnPath(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || value.length > 300) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/^\/(admin|api)(\/|$)/.test(value)) return fallback;
  return value;
}

/** Client address for rate limits. Trustworthy only behind a proxy that overwrites the header. */
export async function customerRequest(): Promise<CustomerRequest> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return { ip };
}

const globalForCustomers = globalThis as typeof globalThis & {
  __customerLimiter?: RateLimiter;
  __customerEmail?: EmailProvider;
};

/**
 * What the account services need for this store. Links in emails use the
 * address this request reached, which has already matched one of the store's
 * own domains (storefrontOrigin checks it), never anything from a form.
 */
export async function customerDeps(): Promise<CustomerDeps> {
  const env = getEnv();
  globalForCustomers.__customerLimiter ??= createRedisRateLimiter(env.REDIS_URL);
  globalForCustomers.__customerEmail ??= createEmailProvider(
    env,
    createLogger("web", env.LOG_LEVEL),
  );
  const [{ store }, storeUrl, locale] = await Promise.all([
    storefrontDb(),
    storefrontOrigin(),
    shopLocale(),
  ]);
  return {
    email: globalForCustomers.__customerEmail,
    limiter: globalForCustomers.__customerLimiter,
    storeUrl,
    storeName: store.name,
    // Account emails are written in the language the shopper is using.
    locale,
  };
}
