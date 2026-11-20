import type { RequestContext } from "@ecom/core";
import { ADMIN_PAGES, type RouteAccess } from "./route-access";

export interface NavItem {
  label: string;
  path: string;
}

/** Admin navigation, in display order. Each path must be in ADMIN_PAGES. */
export const ADMIN_NAV: readonly NavItem[] = [
  { label: "Home", path: "/admin" },
  { label: "Orders", path: "/admin/orders" },
  { label: "Reports", path: "/admin/reports" },
  { label: "Inbox", path: "/admin/inbox" },
  { label: "Products", path: "/admin/catalog/products" },
  { label: "Categories", path: "/admin/catalog/categories" },
  { label: "Brands", path: "/admin/catalog/brands" },
  { label: "Stock", path: "/admin/inventory" },
  { label: "Customers", path: "/admin/customers" },
  { label: "Reviews", path: "/admin/reviews" },
  { label: "Customer photos", path: "/admin/content" },
  { label: "Marketing plan", path: "/admin/marketing/campaigns" },
  { label: "Content posts", path: "/admin/marketing/posts" },
  { label: "Content calendar", path: "/admin/marketing/calendar" },
  { label: "Content library", path: "/admin/marketing/library" },
  { label: "Tracking links", path: "/admin/marketing/links" },
  { label: "Customer segments", path: "/admin/marketing/segments" },
  { label: "Competitor research", path: "/admin/research" },
  { label: "Discount codes", path: "/admin/promotions" },
  { label: "AI assistant", path: "/admin/ai" },
  { label: "Instagram and Facebook", path: "/admin/social" },
  { label: "Store and look", path: "/admin/settings/store" },
  { label: "Policy pages", path: "/admin/settings/pages" },
  { label: "Delivery and tax", path: "/admin/settings/shipping" },
  { label: "Store emails", path: "/admin/settings/notifications" },
  { label: "Access", path: "/admin/access" },
  { label: "Team", path: "/admin/team" },
  { label: "Security", path: "/admin/account/security" },
];

function canOpen(access: RouteAccess, context: Pick<RequestContext, "permissions"> | null) {
  switch (access.level) {
    case "public":
    case "session":
      return true;
    case "tenant":
      return context !== null;
    case "permission":
      return context !== null && context.permissions.has(access.permission);
    case "platform":
      // The platform panel has its own navigation.
      return false;
  }
}

/**
 * The links this user should see: exactly the pages the guards would let
 * them open, decided from the same access registry.
 */
export function visibleNav(context: Pick<RequestContext, "permissions"> | null): NavItem[] {
  return ADMIN_NAV.filter((item) => {
    const page = ADMIN_PAGES.find((entry) => entry.path === item.path);
    if (!page) throw new Error(`Navigation item ${item.path} is not in ADMIN_PAGES`);
    return canOpen(page.access, context);
  });
}
