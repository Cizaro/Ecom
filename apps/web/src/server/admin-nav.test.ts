import type { PermissionKey } from "@ecom/core";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, visibleNav } from "./admin-nav";
import { ADMIN_PAGES } from "./route-access";

const context = (...permissions: PermissionKey[]) => ({ permissions: new Set(permissions) });
const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe("admin navigation", () => {
  it("only links to registered pages", () => {
    const registered = new Set(ADMIN_PAGES.map((page) => page.path));
    for (const item of ADMIN_NAV) expect(registered.has(item.path), item.path).toBe(true);
  });

  it("shows tenant pages only with a tenant, and permission pages only with the permission", () => {
    expect(labels(visibleNav(null))).toEqual(["Home", "Security"]);
    expect(labels(visibleNav(context("marketing.write")))).toEqual(["Home", "Access", "Security"]);
    expect(labels(visibleNav(context("catalog.read")))).toEqual([
      "Home",
      "Products",
      "Categories",
      "Brands",
      "Access",
      "Security",
    ]);
    expect(labels(visibleNav(context("staff.manage")))).toEqual([
      "Home",
      "Access",
      "Team",
      "Security",
    ]);
  });
});
