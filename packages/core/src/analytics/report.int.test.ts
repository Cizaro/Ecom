import { randomUUID } from "node:crypto";
import { createGateway, createMockProvider, dollarsToMicros } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { createAiLedger } from "../ai/ai-admin";
import { addToCart } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { followLink } from "../marketing/links";
import { placeOrder } from "../orders/orders";
import { isBot, normalizeQuery, recordShopEvent } from "./events";
import { askAboutReport, getAnalyticsReport, productsCsv, reportFacts } from "./report";

// Shop events and the reports page against the real (test) database on the
// runtime connection, so Row-Level Security applies. Each store is new, so
// its figures are exact.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Analytics ${label} ${run}`, slug: `an-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main", timezone: "Asia/Beirut" },
  });
  const user = await admin.user.create({
    data: { email: `an-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const as = (role: SystemRoleKey) => {
    const context: RequestContext = {
      requestId: `req-${run}`,
      ip: "203.0.113.64",
      userId: user.id,
      isPlatformAdmin: false,
      tenantId: tenant.id,
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
  };
  return {
    tenantId: tenant.id,
    userId: user.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    as,
  };
}

async function product(
  tenantId: string,
  name: string,
  price: number,
  stock: number,
  category?: string,
) {
  const tag = randomUUID().slice(0, 8);
  const categoryRow = category
    ? await admin.category.create({ data: { tenantId, name: category, slug: `c-${tag}` } })
    : null;
  const row = await admin.product.create({
    data: { tenantId, name, slug: `p-${tag}`, status: "active", categoryId: categoryRow?.id },
  });
  const variant = await admin.productVariant.create({
    data: {
      tenantId,
      productId: row.id,
      sku: `SKU-${tag}`,
      priceAmount: price,
      currency: "USD",
      trackInventory: true,
    },
  });
  const location =
    (await admin.inventoryLocation.findFirst({ where: { tenantId, isDefault: true } })) ??
    (await admin.inventoryLocation.create({ data: { tenantId, name: "Main", isDefault: true } }));
  await admin.inventoryLevel.create({
    data: { tenantId, variantId: variant.id, locationId: location.id, onHand: stock },
  });
  return { productId: row.id, variantId: variant.id, sku: variant.sku };
}

async function cashOrder(shop: TenantDb, variantId: string, quantity: number) {
  const { token } = await addToCart(shop, null, { variantId, quantity });
  return placeOrder(shop, {
    owner: { token: token! },
    customer: null,
    email: "rami@example.test",
    address: {
      fullName: "Rami Haddad",
      phone: "+961 3 123 456",
      line1: "Hamra 5",
      city: "Beirut",
      country: "LB",
    },
    paymentMethod: "cash_on_delivery",
    accessSecret: "k".repeat(40),
  });
}

const gatewayFor = (userId: string) =>
  createGateway({
    provider: createMockProvider(),
    ledger: createAiLedger(app, userId),
    model: "mock",
    globalPaused: false,
    platformMonthlyBudgetMicros: dollarsToMicros(50),
  });

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("shop events", () => {
  it("normalize searches and recognise bots", () => {
    expect(normalizeQuery("  Leather   TOTE ")).toBe("leather tote");
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")).toBe(false);
  });

  it("refuse events that are not valid, and the database refuses personal-looking extras", async () => {
    const s = await store("events");
    expect(await recordShopEvent(s.shop, { name: "search", query: "   " })).toBe(false);
    expect(await recordShopEvent(s.shop, { name: "nope" as never })).toBe(false);
    expect(await recordShopEvent(s.shop, { name: "product_view", productId: "not-an-id" })).toBe(
      true,
    );
    const saved = await admin.analyticsEvent.findFirstOrThrow({ where: { tenantId: s.tenantId } });
    expect(saved.productId).toBeNull();
    // A search must carry its query, and only a search may.
    await expect(
      admin.analyticsEvent.create({ data: { tenantId: s.tenantId, name: "search" } }),
    ).rejects.toThrow();
  });
});

describe("reports", () => {
  it("count sales, products, the funnel, searches, campaigns and what will run out", async () => {
    const s = await store("main");
    const tote = await product(s.tenantId, "Leather Tote", 5000, 6, "Bags");
    const belt = await product(s.tenantId, "Belt", 2000, 50);
    for (let i = 0; i < 3; i += 1)
      await recordShopEvent(s.shop, { name: "product_view", productId: tote.productId });
    await recordShopEvent(s.shop, { name: "product_view", productId: belt.productId });
    await recordShopEvent(s.shop, { name: "checkout_started" });
    await recordShopEvent(s.shop, { name: "search", query: "Tote", resultCount: 1 });
    await recordShopEvent(s.shop, { name: "search", query: "tote", resultCount: 1 });
    await recordShopEvent(s.shop, { name: "search", query: "wallet", resultCount: 0 });
    await cashOrder(s.shop, tote.variantId, 4); // adds to cart too
    await cashOrder(s.shop, belt.variantId, 1);

    // A campaign with a tracking link that is clicked twice.
    const campaign = await admin.marketingCampaign.create({
      data: { tenantId: s.tenantId, name: "Autumn bags", objective: "sales", startsOn: new Date() },
    });
    await admin.utmLink.create({
      data: {
        tenantId: s.tenantId,
        campaignId: campaign.id,
        label: "Story",
        destinationPath: "/",
        source: "instagram",
        medium: "social",
        utmCampaign: "autumn",
        shortCode: `an${run}`,
      },
    });
    await followLink(s.shop, `an${run}`);
    await followLink(s.shop, `an${run}`);

    const { context, db } = s.as("store_owner");
    const report = await getAnalyticsReport(db, context, "7");
    expect(report.days).toBe(7);
    expect(report.summary).toMatchObject({ orders: 2, units: 5, guestOrders: 2 });
    expect(report.summary.sales).toBeGreaterThanOrEqual(22000); // goods; delivery and tax may add to it
    expect(report.topProducts[0]).toMatchObject({
      name: "Leather Tote",
      units: 4,
      revenue: 20000,
      views: 3,
      addsToCart: 1,
    });
    expect(report.categories.map((c) => c.name)).toEqual(["Bags", "No category"]);
    expect(report.funnel).toEqual({ views: 4, addsToCart: 2, checkouts: 1, orders: 2 });
    expect(report.searches).toEqual([
      { query: "tote", count: 2, noResults: false },
      { query: "wallet", count: 1, noResults: true },
    ]);
    expect(report.campaigns).toEqual([{ name: "Autumn bags", clicks: 2, orders: 0, revenue: 0 }]);
    expect(report.forecast.enough).toBe(false);
    // 6 on hand, 4 held by the order: 2 left at 4 sold in 28 days -> 14 days.
    expect(report.runningOut).toEqual([
      expect.objectContaining({ sku: tote.sku, available: 2, daysLeft: 14 }),
    ]);

    const facts = reportFacts(report);
    expect(facts.find((f) => f.id === "product:1")?.text).toContain(
      "Leather Tote, $200.00 from 4 units",
    );
    expect(facts.find((f) => f.id === "search:2")?.text).toContain("found nothing");
    expect(productsCsv(report).csv.split("\r\n")[1]).toBe("Leather Tote,4,200.00,3,1");
  });

  it("answer questions from the report's figures, for staff who may use AI", async () => {
    const s = await store("ask");
    const tote = await product(s.tenantId, "Leather Tote", 5000, 20);
    await cashOrder(s.shop, tote.variantId, 2);
    const owner = s.as("store_owner");
    const { result, facts } = await askAboutReport(owner.db, owner.context, gatewayFor(s.userId), {
      question: "Which product was number 1 by sales?",
      days: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.citations).toEqual(["product:1"]);
    expect(result.output.answer).toContain("Leather Tote");
    expect(facts.length).toBeGreaterThan(5);
    const event = await admin.aiEvent.findFirstOrThrow({
      where: { tenantId: s.tenantId, task: "report.question" },
    });
    expect(event.status).toBe("ok");

    // Inventory managers see reports but do not use AI; customer service sees neither.
    const inventory = s.as("inventory_manager");
    await expect(
      askAboutReport(inventory.db, inventory.context, gatewayFor(s.userId), {
        question: "Sales?",
        days: 30,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const service = s.as("customer_service");
    await expect(getAnalyticsReport(service.db, service.context, 30)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("keep each store's figures to itself", async () => {
    const a = await store("iso-a");
    const b = await store("iso-b");
    const tote = await product(a.tenantId, "Leather Tote", 5000, 20);
    await recordShopEvent(a.shop, { name: "product_view", productId: tote.productId });
    await cashOrder(a.shop, tote.variantId, 1);
    const ownerB = b.as("store_owner");
    const report = await getAnalyticsReport(ownerB.db, ownerB.context, 30);
    expect(report.summary.orders).toBe(0);
    expect(report.funnel).toEqual({ views: 0, addsToCart: 0, checkouts: 0, orders: 0 });
    expect(report.topProducts).toEqual([]);
    // Store B cannot record an event about store A's product.
    await expect(
      recordShopEvent(b.shop, { name: "product_view", productId: tote.productId }),
    ).rejects.toThrow();
  });
});
