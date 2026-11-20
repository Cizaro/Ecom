import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { seedSystemData } from "../identity/seed";
import { resolveStoreHost } from "../tenancy/store-host";
import {
  createShop,
  getShop,
  listShops,
  PlatformError,
  platformOverview,
  setShopStatus,
} from "./shops";

// The platform owner's panel against the real (test) database.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const actor = { userId: randomUUID(), ip: "203.0.113.120" };
const created: string[] = [];
const emails: string[] = [];

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: created } } });
  await admin.user.deleteMany({ where: { email: { in: emails } } });
  await disconnectDatabase();
});

describe("platform shops", () => {
  it("creates a shop with its address and a new owner, then lists and details it", async () => {
    await seedSystemData(admin);
    const ownerEmail = `owner-${run}@example.test`;
    emails.push(ownerEmail);
    const shop = await createShop(env.DATABASE_ADMIN_URL, actor, {
      name: `Tamara ${run}`,
      slug: `tamara-${run}`,
      address: `tamara-${run}.platform.test`,
      ownerEmail,
      ownerName: "Tamara",
    });
    created.push(shop.id);
    expect(shop).toMatchObject({ ownerEmail, newOwner: true });
    // The shop answers at its address.
    expect(await resolveStoreHost(app, `tamara-${run}.platform.test`)).toMatchObject({
      tenantId: shop.id,
    });

    const rows = await listShops(env.DATABASE_ADMIN_URL, { search: `tamara-${run}` });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", owner: ownerEmail, products: 0 });
    const detail = await getShop(env.DATABASE_ADMIN_URL, shop.id);
    expect(detail?.team).toEqual([
      expect.objectContaining({ email: ownerEmail, role: "Store owner" }),
    ]);
    expect(detail?.recent.map((r) => r.action)).toContain("platform.shop_created");

    // Taken short names and addresses are refused.
    await expect(
      createShop(env.DATABASE_ADMIN_URL, actor, {
        name: "Again",
        slug: `tamara-${run}`,
        address: `other-${run}.platform.test`,
        ownerEmail,
        ownerName: "",
      }),
    ).rejects.toBeInstanceOf(PlatformError);
    await expect(
      createShop(env.DATABASE_ADMIN_URL, actor, {
        name: "Again",
        slug: `again-${run}`,
        address: `tamara-${run}.platform.test`,
        ownerEmail,
        ownerName: "",
      }),
    ).rejects.toThrow(/already belongs/);
  });

  it("suspends a shop (its address stops answering) and resumes it, with a reason", async () => {
    const ownerEmail = `owner2-${run}@example.test`;
    emails.push(ownerEmail);
    const shop = await createShop(env.DATABASE_ADMIN_URL, actor, {
      name: `Cedar ${run}`,
      slug: `cedar-${run}`,
      address: `cedar-${run}.platform.test`,
      ownerEmail,
      ownerName: "",
    });
    created.push(shop.id);
    await expect(
      setShopStatus(env.DATABASE_ADMIN_URL, actor, shop.id, "suspended", ""),
    ).rejects.toThrow(/why/);
    await setShopStatus(env.DATABASE_ADMIN_URL, actor, shop.id, "suspended", "Unpaid invoice");
    expect(await resolveStoreHost(app, `cedar-${run}.platform.test`)).toBeNull();
    await setShopStatus(env.DATABASE_ADMIN_URL, actor, shop.id, "active");
    expect(await resolveStoreHost(app, `cedar-${run}.platform.test`)).not.toBeNull();
    expect(
      await admin.auditLog.count({
        where: {
          tenantId: shop.id,
          action: { in: ["platform.shop_suspended", "platform.shop_resumed"] },
        },
      }),
    ).toBe(2);

    const overview = await platformOverview(env.DATABASE_ADMIN_URL);
    expect(overview.shops.total).toBeGreaterThanOrEqual(2);
    expect(overview.ordersPerDay).toHaveLength(14);
  });
});
