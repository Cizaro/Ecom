import type { RequestContext } from "@ecom/core";
import { ADMIN_PAGES, type RouteAccess } from "./route-access";

export interface NavItem {
  label: string;
  path: string;
}

/** Admin navigation, in display order. Each path must be in ADMIN_PAGES. */
export const ADMIN_NAV: readonly NavItem[] = [
  { label: "Home", path: "/admin" },
  { label: "Products", path: "/admin/catalog/products" },
  { label: "Categories", path: "/admin/catalog/categories" },
  { label: "Brands", path: "/admin/catalog/brands" },
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
