import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { makeTestImage } from "@ecom/testing";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createMemoryStorage } from "../storage/storage";
import { DEFAULT_BRANDING } from "./branding";
import { loadStorefront } from "./store-host";
import {
  getStoreSettings,
  removeStoreLogo,
  setStoreLogo,
  StoreSettingsError,
  updateStoreBranding,
  updateStoreDetails,
} from "./store-settings";

// A store's own settings and look, against the real (test) database on the
// runtime connection: two stores on one installation never share them.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Look ${label} ${run}`, slug: `look-${label}-${run}` },
  });
  const row = await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" },
  });
  const hostname = `look-${label}-${run}.example.test`;
  await admin.storeDomain.create({
    data: { tenantId: tenant.id, storeId: row.id, hostname, isPrimary: true },
  });
  tenantIds.push(tenant.id);
  return { tenantId: tenant.id, hostname, owner: await staff(tenant.id, "store_owner") };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `look-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.67",
    userId: user.id,
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: null,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(
      SYSTEM_ROLES.find((r) => r.key === role)!.permissions as readonly PermissionKey[],
    ),
  };
  return { context, db: createTenantDb(app, context) };
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("two stores on one installation", () => {
  it("each have their own name, look, logo and contact details", async () => {
    const a = await store("a");
    const b = await store("b");

    await updateStoreDetails(a.owner.db, a.owner.context, {
      name: "Cedar Bags",
      timezone: "Asia/Beirut",
      tagline: "Handmade in Beirut",
      contactEmail: "Hello@Cedar.test",
      contactPhone: "+961 1 234 567",
    });
    await updateStoreBranding(a.owner.db, a.owner.context, { preset: "fresh" });
    const storage = createMemoryStorage();
    await setStoreLogo(
      a.owner.db,
      a.owner.context,
      { storage },
      await makeTestImage({ width: 200, height: 80, format: "png" }),
    );

    const shopA = (await loadStorefront(app, a.hostname))!;
    expect(shopA.name).toBe("Cedar Bags");
    expect(shopA.branding).toMatchObject({
      brandColor: "#166534",
      corners: "round",
      font: "rounded",
      tagline: "Handmade in Beirut",
      contactEmail: "hello@cedar.test",
    });
    expect(shopA.logo).not.toBeNull();

    // Store B is untouched: the default look, no logo.
    const shopB = (await loadStorefront(app, b.hostname))!;
    expect(shopB.name).toBe("Shop b");
    expect(shopB.branding).toEqual(DEFAULT_BRANDING);
    expect(shopB.logo).toBeNull();
    // And store B's own colours do not change store A.
    await updateStoreBranding(b.owner.db, b.owner.context, {
      brandColor: "#1E3A8A",
      accentColor: "#1d4ed8",
      corners: "sharp",
      font: "serif",
    });
    expect((await loadStorefront(app, a.hostname))!.branding.brandColor).toBe("#166534");
    expect((await loadStorefront(app, b.hostname))!.branding).toMatchObject({
      brandColor: "#1e3a8a",
      corners: "sharp",
    });

    // Replacing the logo removes the old file; removing it leaves none.
    await setStoreLogo(
      a.owner.db,
      a.owner.context,
      { storage },
      await makeTestImage({ width: 120, height: 120, format: "png" }),
    );
    expect(storage.files.size).toBe(1);
    await removeStoreLogo(a.owner.db, a.owner.context, { storage });
    expect(storage.files.size).toBe(0);
    expect((await getStoreSettings(a.owner.db, a.owner.context)).logo).toBeNull();
  });

  it("refuse values that would break the shop, and staff without settings.write", async () => {
    const s = await store("checks");
    const attempt = (input: Parameters<typeof updateStoreBranding>[2]) =>
      updateStoreBranding(s.owner.db, s.owner.context, {
        brandColor: "#111111",
        accentColor: "#b45309",
        corners: "soft",
        font: "sans",
        ...input,
      });
    await expect(attempt({ brandColor: "red; background:url(x)" })).rejects.toThrow(
      StoreSettingsError,
    );
    await expect(attempt({ accentColor: "#fde68a" })).rejects.toThrow(/too light to read/);
    await expect(attempt({ corners: "wavy" })).rejects.toThrow(StoreSettingsError);
    await expect(
      updateStoreDetails(s.owner.db, s.owner.context, { name: "", timezone: "UTC" }),
    ).rejects.toThrow("Enter the store's name.");
    await expect(
      updateStoreDetails(s.owner.db, s.owner.context, { name: "Shop", timezone: "Mars/Base" }),
    ).rejects.toThrow(/time zone/);
    await expect(
      setStoreLogo(
        s.owner.db,
        s.owner.context,
        { storage: createMemoryStorage() },
        new TextEncoder().encode("not an image"),
      ),
    ).rejects.toThrow(StoreSettingsError);

    const stock = await staff(s.tenantId, "inventory_manager");
    await expect(getStoreSettings(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
    await expect(updateStoreBranding(stock.db, stock.context, { preset: "ocean" })).rejects.toThrow(
      ForbiddenError,
    );
    const logged = await admin.auditLog.count({
      where: { tenantId: s.tenantId, action: { startsWith: "settings.store_" } },
    });
    expect(logged).toBe(0);
  });
});
