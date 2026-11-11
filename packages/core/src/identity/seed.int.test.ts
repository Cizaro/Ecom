import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "./permissions";
import { DEMO_OWNER_EMAIL, DEMO_TENANT_SLUG, seedDemoData, seedSystemData } from "./seed";

const admin = getAdminPrisma(getEnv().DATABASE_ADMIN_URL);

afterAll(disconnectDatabase);

async function systemSnapshot() {
  const roles = await admin.role.findMany({
    where: { tenantId: null, isSystem: true },
    include: { permissions: { include: { permission: true } } },
    orderBy: { key: "asc" },
  });
  return {
    permissionKeys: (await admin.permission.findMany({ orderBy: { key: "asc" } })).map(
      (p) => p.key,
    ),
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      permissions: role.permissions.map((rp) => rp.permission.key).sort(),
    })),
  };
}

describe("seedSystemData", () => {
  it("writes the catalogue and the system roles exactly as defined in code", async () => {
    await seedSystemData(admin);
    const snapshot = await systemSnapshot();

    expect(snapshot.permissionKeys).toEqual([...ALL_PERMISSIONS].sort());
    expect(snapshot.roles.map((r) => r.key)).toEqual(SYSTEM_ROLES.map((r) => r.key).sort());
    for (const definition of SYSTEM_ROLES) {
      const stored = snapshot.roles.find((r) => r.key === definition.key)!;
      expect(stored.permissions, definition.key).toEqual([...definition.permissions].sort());
    }
  });

  it("is idempotent: a second run changes nothing, including ids", async () => {
    await seedSystemData(admin);
    const first = await systemSnapshot();
    await seedSystemData(admin);
    expect(await systemSnapshot()).toEqual(first);
  });

  it("removes stale permissions and repairs tampered system roles", async () => {
    const stale = await admin.permission.create({
      data: { key: "stale.permission", description: "No longer in the catalogue" },
    });
    const editor = await admin.role.findFirstOrThrow({
      where: { tenantId: null, key: "content_editor" },
    });
    await admin.rolePermission.create({ data: { roleId: editor.id, permissionId: stale.id } });
    const refund = await admin.permission.findUniqueOrThrow({ where: { key: "orders.refund" } });
    await admin.rolePermission.create({ data: { roleId: editor.id, permissionId: refund.id } });

    const summary = await seedSystemData(admin);

    expect(summary.removedPermissions).toBe(1);
    const snapshot = await systemSnapshot();
    expect(snapshot.permissionKeys).not.toContain("stale.permission");
    expect(snapshot.roles.find((r) => r.key === "content_editor")!.permissions).not.toContain(
      "orders.refund",
    );
  });
});

describe("seedDemoData", () => {
  it("creates one demo tenant, store and owner, and is idempotent", async () => {
    await seedSystemData(admin);
    const first = await seedDemoData(admin);
    const second = await seedDemoData(admin);
    expect(second).toEqual(first);

    const tenant = await admin.tenant.findUniqueOrThrow({
      where: { slug: DEMO_TENANT_SLUG },
      include: { stores: true, memberships: { include: { user: true, role: true } } },
    });
    expect(tenant.stores).toHaveLength(1);
    expect(tenant.memberships).toHaveLength(1);
    expect(tenant.memberships[0]!.role.key).toBe("store_owner");
    expect(tenant.memberships[0]!.user.email).toBe(DEMO_OWNER_EMAIL);
    // Nobody can sign in as the demo owner until a password is set.
    const credentials = await admin.account.count({
      where: { userId: tenant.memberships[0]!.user.id },
    });
    expect(credentials).toBe(0);
  });
});
