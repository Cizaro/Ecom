import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { checkLaunchStore } from "../platform/launch-check";
import {
  getPublishedPage,
  listPublishedPages,
  listStorePages,
  pageTemplate,
  saveStorePage,
  StorePageError,
} from "./store-pages";

// Policy pages and the store part of the launch check, against the real
// (test) database on the runtime connection.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

async function store(label: string) {
  const slug = `pages-${label}-${run}`;
  const tenant = await admin.tenant.create({ data: { name: `Pages ${label} ${run}`, slug } });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return {
    slug,
    tenantId: tenant.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    owner: await staff(tenant.id, "store_owner"),
  };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `pages-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.70",
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

describe("policy pages", () => {
  it("cannot be published with blanks left; drafts are not shown", async () => {
    const s = await store("publish");
    const template = pageTemplate("returns", "Shop");
    await expect(
      saveStorePage(s.owner.db, s.owner.context, "returns", {
        title: "Returns",
        body: template,
        publish: true,
      }),
    ).rejects.toThrow(/Fill in the blanks/);
    // Saved as a draft: kept, not shown.
    await saveStorePage(s.owner.db, s.owner.context, "returns", {
      title: "Returns",
      body: template,
      publish: false,
    });
    expect(await getPublishedPage(s.shop, "returns")).toBeNull();
    expect((await listStorePages(s.owner.db, s.owner.context))[0]).toMatchObject({
      slug: "returns",
      published: false,
    });

    const filled =
      "You can return unused items within 14 days of receiving them. Contact us first.";
    await saveStorePage(s.owner.db, s.owner.context, "returns", {
      title: "Returns and refunds",
      body: filled,
      publish: true,
    });
    expect(await getPublishedPage(s.shop, "returns")).toMatchObject({
      title: "Returns and refunds",
      body: filled,
    });
    expect(await listPublishedPages(s.shop)).toEqual([
      { slug: "returns", title: "Returns and refunds" },
    ]);
    // Unknown pages and too-short pages are refused.
    await expect(
      saveStorePage(s.owner.db, s.owner.context, "about", {
        title: "x",
        body: "y",
        publish: false,
      }),
    ).rejects.toThrow(StorePageError);
    await expect(
      saveStorePage(s.owner.db, s.owner.context, "terms", {
        title: "Terms",
        body: "Short.",
        publish: true,
      }),
    ).rejects.toThrow(/50 characters/);
  });

  it("belong to one store and need settings.write", async () => {
    const a = await store("a");
    const b = await store("b");
    await saveStorePage(a.owner.db, a.owner.context, "privacy", {
      title: "Privacy",
      body: "We use your details only to deliver your orders and answer your messages.",
      publish: true,
    });
    expect(await getPublishedPage(b.shop, "privacy")).toBeNull();
    const stock = await staff(a.tenantId, "inventory_manager");
    await expect(listStorePages(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
  });
});

describe("launch check of a store", () => {
  it("lists what is missing before going live", async () => {
    const s = await store("launch");
    const findings = await checkLaunchStore(env.DATABASE_ADMIN_URL, s.slug);
    const byLabel = Object.fromEntries(findings.map((f) => [f.label, f.status]));
    expect(byLabel).toMatchObject({
      "Web address": "fail",
      Products: "fail",
      "Delivery areas": "warn",
      "Policy page: returns": "warn",
      "Two-factor sign-in": "warn",
    });
    expect(await checkLaunchStore(env.DATABASE_ADMIN_URL, `missing-${run}`)).toEqual([
      expect.objectContaining({ status: "fail", label: "Store" }),
    ]);
  });
});
