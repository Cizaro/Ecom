import "server-only";

import { getEnv } from "@ecom/config";
import { loadStorefront, type Storefront } from "@ecom/core";
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
