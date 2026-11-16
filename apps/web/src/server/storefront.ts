import "server-only";

import { getEnv } from "@ecom/config";
import {
  createTenantDb,
  loadStorefront,
  NotFoundError,
  storefrontRequestHost,
  type Storefront,
  type TenantDb,
} from "@ecom/core";
import { getAppPrisma } from "@ecom/db";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

/** The host this request was made to (see storefrontRequestHost for the one exception). */
async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return storefrontRequestHost(requestHeaders.get("host"), requestHeaders.get("x-forwarded-host"));
}

/**
 * The store this storefront request is for, found from the host name. The
 * tenant is never taken from anything else the client sends. Unknown hosts
 * get the 404 page.
 */
export const requireStorefront = cache(async (): Promise<Storefront> => {
  const host = await requestHost();
  const storefront = await loadStorefront(getAppPrisma(getEnv().DATABASE_URL), host);
  if (!storefront) notFound();
  return storefront;
});

/**
 * Database handle for shopper-facing reads, bound to the store's tenant.
 * There is no signed-in user: Row-Level Security limits every query to this
 * tenant, and the public catalog services ask only for published products.
 */
export async function storefrontDb(): Promise<{ store: Storefront; db: TenantDb }> {
  const store = await requireStorefront();
  return {
    store,
    db: createTenantDb(getAppPrisma(getEnv().DATABASE_URL), { tenantId: store.tenantId }),
  };
}

/** For pages: load a public record or show the 404 page. */
export async function publicOrNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * The address this storefront is being reached at, for absolute links in
 * page metadata. The host name has already matched a store (requireStorefront),
 * so it is not an arbitrary value from the request.
 */
export async function storefrontOrigin(): Promise<string> {
  await requireStorefront();
  const requestHeaders = await headers();
  const host = (await requestHost()) ?? new URL(getEnv().APP_URL).host;
  const forwarded = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwarded === "https" || forwarded === "http"
      ? forwarded
      : new URL(getEnv().APP_URL).protocol.replace(":", "");
  return `${protocol}://${host}`;
}
