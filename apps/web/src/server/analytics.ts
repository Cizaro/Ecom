import "server-only";

import { getEnv } from "@ecom/config";
import { createLogger, isBot, recordShopEvent, type ShopEvent, type TenantDb } from "@ecom/core";
import { headers } from "next/headers";

// Records a shop event from a storefront page (Milestone 7.4, D109). Skips
// crawlers, link previews and prefetches, and never breaks the page: a
// failure is logged and the shopper sees nothing.

export async function trackShopEvent(db: TenantDb, event: ShopEvent): Promise<void> {
  try {
    const requestHeaders = await headers();
    const prefetch =
      requestHeaders.get("next-router-prefetch") !== null ||
      requestHeaders.get("purpose") === "prefetch" ||
      requestHeaders.get("sec-purpose")?.includes("prefetch");
    if (prefetch || isBot(requestHeaders.get("user-agent"))) return;
    await recordShopEvent(db, event);
  } catch (error) {
    createLogger("web", getEnv().LOG_LEVEL).warn(
      { err: error, event: event.name },
      "shop event not recorded",
    );
  }
}
