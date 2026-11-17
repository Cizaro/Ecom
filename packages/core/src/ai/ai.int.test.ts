import { randomUUID } from "node:crypto";
import { createGateway, createMockProvider, dollarsToMicros } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { saveStorePage } from "../tenancy/store-pages";
import {
  createAiLedger,
  getAiOverview,
  getBusinessProfile,
  saveAiSettings,
  saveBusinessProfile,
  tryCustomerAnswer,
} from "./ai-admin";
import { createCommerceKnowledge } from "./commerce-knowledge";

// The platform's side of the AI module against the real (test) database, on
// the runtime connection, with the mock provider (no outside calls).

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.90",
    userId,
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
}

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `AI ${label} ${run}`, slug: `ai-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({
    data: {
      tenantId: tenant.id,
      name: `Cedar ${label}`,
      slug: "main",
      branding: { contactEmail: "hello@cedar.example.test" },
    },
  });
  const user = await admin.user.create({
    data: { email: `ai-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const product = await admin.product.create({
    data: { tenantId: tenant.id, name: "Leather Tote", slug: "leather-tote", status: "active" },
  });
  await admin.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `AI-${label}-${run}`,
      priceAmount: 4990,
      currency: "USD",
    },
  });
  await admin.shippingZone.create({
    data: {
      tenantId: tenant.id,
      name: "All of Lebanon",
      countries: ["LB"],
      rateAmount: 400,
      currency: "USD",
    },
  });
  const owner = contextFor(tenant.id, user.id, "store_owner");
  return { tenantId: tenant.id, userId: user.id, owner, db: createTenantDb(app, owner) };
}

const gatewayFor = (userId: string, budgetDollars = 50) =>
  createGateway({
    provider: createMockProvider(),
    ledger: createAiLedger(app, userId),
    model: "mock",
    globalPaused: false,
    platformMonthlyBudgetMicros: dollarsToMicros(budgetDollars),
  });

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("AI for a store", () => {
  it("answers from the store's own facts and records the run", async () => {
    const s = await store("facts");
    await saveStorePage(s.db, s.owner, "returns", {
      title: "Returns",
      body: "## Refunds\nYou can return unused items within 14 days of receiving them for a refund.",
      publish: true,
    });
    const knowledge = createCommerceKnowledge(s.db, {
      name: "Cedar",
      branding: { contactEmail: "hello@cedar.example.test" } as never,
    });
    const facts = await knowledge.search("How much is the leather tote, and can I return it?", {
      limit: 12,
      language: "en",
    });
    const texts = facts.map((fact) => `${fact.id} ${fact.text}`).join("\n");
    expect(texts).toMatch(/product:leather-tote Leather Tote costs \$49\.90 and is sold out\./);
    expect(texts).toMatch(/delivery:.* Delivery to All of Lebanon costs \$4\.00\./);
    expect(texts).toMatch(/policy:returns#\d .*14 days/);
    expect(texts).toMatch(/store:contact .*hello@cedar\.example\.test/);
    // Stock is never given as a number.
    expect(texts).not.toMatch(/\bin stock: \d/);

    const result = await tryCustomerAnswer(s.db, s.owner, gatewayFor(s.userId), {
      question: "How much is the leather tote?",
      language: "en",
    });
    expect(result).toMatchObject({ ok: true, route: "needs_approval" });
    const overview = await getAiOverview(s.db, s.owner, createAiLedger(app, s.userId));
    expect(overview.recent[0]).toMatchObject({
      task: "customer.answer",
      status: "ok",
      costMicros: 0,
    });
    const event = await admin.aiEvent.findFirstOrThrow({ where: { tenantId: s.tenantId } });
    expect(event.userId).toBe(s.userId);
    expect(event.factIds.length).toBeGreaterThan(0);
  });

  it("keeps settings and profile per store, needs ai.configure, and pauses", async () => {
    const a = await store("a");
    const b = await store("b");
    // A starting profile from the store's name.
    expect((await getBusinessProfile(a.db)).name).toBe("Cedar a");
    await saveBusinessProfile(a.db, a.owner, {
      name: "Cedar Bags",
      description: "We sell leather bags and wallets in Lebanon.",
      tone: "Warm and short",
      mayPromise: "",
      neverPromise: "Discounts\nDelivery dates",
      handoverTopics: "Refunds",
      contact: "Call us",
    });
    await saveAiSettings(a.db, a.owner, {
      paused: "on",
      monthlyBudgetUsd: "10",
      automation: "draft",
    });

    expect((await getBusinessProfile(a.db)).neverPromise).toEqual(["Discounts", "Delivery dates"]);
    expect((await getBusinessProfile(b.db)).name).toBe("Cedar b");
    expect(await createAiLedger(app, null).settings(a.tenantId)).toEqual({
      paused: true,
      monthlyBudgetMicros: 10_000_000,
      automation: "draft",
    });
    expect((await createAiLedger(app, null).settings(b.tenantId)).paused).toBe(false);

    // Paused: the run is refused and recorded.
    const paused = await tryCustomerAnswer(a.db, a.owner, gatewayFor(a.userId), {
      question: "Hello?",
      language: "en",
    });
    expect(paused).toMatchObject({ ok: false, status: "paused" });

    // A marketer may use AI but not change its settings.
    const marketer = contextFor(a.tenantId, a.userId, "marketer");
    await expect(
      saveAiSettings(createTenantDb(app, marketer), marketer, {
        paused: "",
        monthlyBudgetUsd: "",
        automation: "auto",
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      saveAiSettings(a.db, a.owner, { paused: "", monthlyBudgetUsd: "lots", automation: "auto" }),
    ).rejects.toThrow(/monthly budget/);
    // One store never sees another's runs.
    expect((await getAiOverview(b.db, b.owner, createAiLedger(app, b.userId))).recent).toEqual([]);
  });

  it("stops at the budget, counted from this month's runs", async () => {
    const s = await store("budget");
    await admin.aiEvent.create({
      data: {
        tenantId: s.tenantId,
        task: "customer.answer",
        provider: "anthropic",
        model: "claude-opus-5-5",
        status: "ok",
        costMicros: 2_000_000,
        factIds: [],
      },
    });
    const result = await tryCustomerAnswer(s.db, s.owner, gatewayFor(s.userId, 2), {
      question: "Hello?",
      language: "en",
    });
    expect(result).toMatchObject({ ok: false, status: "over_budget" });
    // The audit trail cannot be changed by the app.
    await expect(
      createTenantDb(app, s.owner).run((tx) => tx.aiEvent.deleteMany({})),
    ).rejects.toThrow();
  });
});
