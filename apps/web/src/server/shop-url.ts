import "server-only";

import { getEnv } from "@ecom/config";
import { shopHost, type TenantDb } from "@ecom/core";

/**
 * The store's public address for links staff share: its primary domain,
 * with the scheme (and, locally, the port) of APP_URL.
 */
export async function shopOrigin(db: TenantDb): Promise<string> {
  const app = new URL(getEnv().APP_URL);
  const host = await shopHost(db);
  if (!host) return app.origin;
  const port = app.port && !host.includes(":") ? `:${app.port}` : "";
  return `${app.protocol}//${host}${port}`;
}
