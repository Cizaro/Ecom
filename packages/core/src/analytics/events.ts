import type { TenantDb } from "../access/tenant-db";

// Shop events (Milestone 7.4, decision D109): five moments counted inside the
// store's own database, with no personal details at all (no customer,
// session, address, IP or cookie), so no consent banner is needed for them.
// Recording is best effort: a failure is logged by the caller's error
// reporting and never breaks the shopper's page.

export const SHOP_EVENTS = [
  "product_view",
  "add_to_cart",
  "checkout_started",
  "search",
  "link_click",
] as const;
export type ShopEventName = (typeof SHOP_EVENTS)[number];

export interface ShopEvent {
  name: ShopEventName;
  productId?: string | null;
  utmLinkId?: string | null;
  /** What was searched for (search only). */
  query?: string | null;
  resultCount?: number | null;
  locale?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A search as it is counted: trimmed, lowercased, spaces collapsed, at most 100 characters. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
}

/**
 * Crawlers, link previews and monitoring are not shoppers. Matches the user
 * agents of common bots; an empty user agent is treated as a bot too.
 */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|monitor|lighthouse/i.test(
    userAgent,
  );
}

/** Records one shop event in the store's tenant. Returns false when the event is not valid. */
export async function recordShopEvent(db: TenantDb, event: ShopEvent): Promise<boolean> {
  if (!SHOP_EVENTS.includes(event.name)) return false;
  const query = event.name === "search" ? normalizeQuery(event.query ?? "") : null;
  if (event.name === "search" && !query) return false;
  const productId = event.productId && UUID.test(event.productId) ? event.productId : null;
  const utmLinkId = event.utmLinkId && UUID.test(event.utmLinkId) ? event.utmLinkId : null;
  const resultCount =
    typeof event.resultCount === "number" && event.resultCount >= 0
      ? Math.floor(event.resultCount)
      : null;
  const locale = event.locale && /^[a-z]{2}$/.test(event.locale) ? event.locale : null;
  await db.run((tx) =>
    tx.analyticsEvent.create({
      data: {
        tenantId: db.tenantId,
        name: event.name,
        productId,
        utmLinkId,
        query,
        resultCount,
        locale,
      },
      select: { id: true },
    }),
  );
  return true;
}
