import "server-only";

import { getEnv } from "@ecom/config";
import {
  createTenantDb,
  loadStorefront,
  NotFoundError,
  type Storefront,
  type TenantDb,
} from "@ecom/core";
import { getAppPrisma } from "@ecom/db";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

/**
 * The store this storefront request is for, found from the Host header. The
 * tenant is never taken from anything else the client sends. Unknown hosts
 * get the 404 page.
 */
export const requireStorefront = cache(async (): Promise<Storefront> => {
  const host = (await headers()).get("host");
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
