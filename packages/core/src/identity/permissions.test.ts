import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  isPermissionKey,
  PERMISSIONS,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
  type PermissionKey,
  type SystemRoleKey,
} from "./permissions";

const role = (key: SystemRoleKey) => SYSTEM_ROLES.find((r) => r.key === key)!;
const rolesWith = (permission: PermissionKey) =>
  SYSTEM_ROLES.filter((r) => (r.permissions as readonly PermissionKey[]).includes(permission))
    .map((r) => r.key)
    .sort();

describe("permission catalogue", () => {
  it("uses module.action keys with a description each", () => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      expect(key).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      expect(description.length).toBeGreaterThan(10);
    }
  });

  it("recognises catalogue keys and nothing else", () => {
    expect(isPermissionKey("orders.refund")).toBe(true);
    expect(isPermissionKey("orders.everything")).toBe(false);
    expect(isPermissionKey("toString")).toBe(false);
  });
});

describe("system roles", () => {
  it("defines the seven required roles with unique keys", () => {
    expect(SYSTEM_ROLES.map((r) => r.key).sort()).toEqual([
      "content_editor",
      "customer_service",
      "inventory_manager",
      "marketer",
      "platform_admin",
      "store_manager",
      "store_owner",
    ]);
  });

  it("only grants permissions that exist, with no duplicates", () => {
    for (const r of SYSTEM_ROLES) {
      expect(new Set(r.permissions).size, r.key).toBe(r.permissions.length);
      for (const permission of r.permissions) {
        expect(isPermissionKey(permission), `${r.key}: ${permission}`).toBe(true);
      }
    }
  });

  it("gives platform permissions to the platform administrator only", () => {
    const platform = ALL_PERMISSIONS.filter((key) => key.startsWith("platform."));
    expect(platform.length).toBeGreaterThan(0);
    for (const permission of platform) {
      expect(rolesWith(permission)).toEqual(["platform_admin"]);
    }
  });

  it("gives the store owner every tenant permission and nothing more", () => {
    expect([...role("store_owner").permissions].sort()).toEqual([...TENANT_PERMISSIONS].sort());
  });

  it("keeps the most sensitive actions with the owner", () => {
    const ownerOnly: PermissionKey[] = [
      "staff.manage",
      "customers.delete",
      "ads.launch",
      "giveaways.draw",
      "ai.configure",
      "social.connect",
    ];
    for (const permission of ownerOnly) {
      expect(rolesWith(permission), permission).toEqual(["platform_admin", "store_owner"]);
    }
  });

  it("limits refunds and customer export to owner and manager", () => {
    const expected = ["platform_admin", "store_manager", "store_owner"];
    expect(rolesWith("orders.refund")).toEqual(expected);
    expect(rolesWith("customers.export")).toEqual(expected);
  });

  it("does not let content editors approve or publish", () => {
    const permissions = role("content_editor").permissions as readonly PermissionKey[];
    expect(permissions).not.toContain("content.approve");
    expect(permissions).not.toContain("social.publish");
  });
});
