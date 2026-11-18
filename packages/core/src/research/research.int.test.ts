import { randomUUID } from "node:crypto";
import { createGateway, createMockProvider, dollarsToMicros } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { createAiLedger } from "../ai/ai-admin";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import {
  addObservation,
  decideIdea,
  deleteObservation,
  draftResearchIdeas,
  getCompetitor,
  listCompetitors,
  listIdeas,
  recentObservations,
  saveCompetitor,
  socialHandle,
} from "./research";

// Competitor research against the real (test) database, on the runtime
// connection. AI is the stand-in.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

const gateway = () =>
  createGateway({
    provider: createMockProvider(),
    ledger: createAiLedger(app, null),
    model: "mock",
    globalPaused: false,
    platformMonthlyBudgetMicros: dollarsToMicros(50),
  });

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.97",
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
    data: { name: `Research ${label} ${run}`, slug: `research-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  const user = await admin.user.create({
    data: { email: `research-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const product = await admin.product.create({
    data: { tenantId: tenant.id, name: "Leather Tote", slug: "leather-tote", status: "active" },
  });
  await admin.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `RS-${label}-${run}`,
      priceAmount: 8900,
      discountPriceAmount: 7900,
      currency: "USD",
    },
  });
  const as = (role: SystemRoleKey) => {
    const context = contextFor(tenant.id, user.id, role);
    return { context, db: createTenantDb(app, context) };
  };
  return { tenantId: tenant.id, productId: product.id, as };
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("socialHandle", () => {
  it("reads @names and profile addresses", () => {
    expect(socialHandle("@bag.shop_lb", "x")).toBe("bag.shop_lb");
    expect(socialHandle("https://www.instagram.com/bagshop/", "x")).toBe("bagshop");
    expect(socialHandle("https://www.tiktok.com/@bagshop", "x")).toBe("bagshop");
    expect(() => socialHandle("not a handle!", "x")).toThrow(/account name/);
  });
});

describe("competitor research", () => {
  it("keeps competitors and observations, compares prices, and drafts cited ideas", async () => {
    const s = await store("main");
    const { db, context } = s.as("marketer");
    const competitor = await saveCompetitor(db, context, null, {
      name: "Bag House",
      website: "baghouse.example",
      instagram: "@baghouse",
      tags: "Bags, Beirut",
    });
    await expect(saveCompetitor(db, context, null, { name: "Bag House" })).rejects.toThrow(
      /already listed/,
    );
    await expect(
      saveCompetitor(db, context, null, { name: "Bad", website: "javascript:alert(1)" }),
    ).rejects.toThrow(/web address/);

    const price = await addObservation(db, context, competitor.id, {
      kind: "price",
      title: "Similar tote for $65",
      price: "65",
      sourceUrl: "https://baghouse.example/tote",
      observedOn: new Date().toISOString().slice(0, 10),
      productId: s.productId,
    });
    await addObservation(db, context, competitor.id, {
      kind: "post",
      title: "Reels of bags on the beach get many comments",
    });
    await expect(
      addObservation(db, context, competitor.id, { kind: "price", title: "x", price: "lots" }),
    ).rejects.toThrow(/amount/);
    await expect(
      addObservation(db, context, competitor.id, {
        kind: "post",
        title: "x",
        observedOn: "2999-01-01",
      }),
    ).rejects.toThrow(/future/);

    const view = await getCompetitor(db, context, competitor.id);
    expect(view).toMatchObject({
      name: "Bag House",
      website: "https://baghouse.example/",
      instagram: "baghouse",
      tags: ["bags", "beirut"],
      observationCount: 2,
    });
    const priceObservation = view.observations.find((o) => o.id === price.id)!;
    expect(priceObservation).toMatchObject({
      priceAmount: 6500,
      currency: "USD",
      ours: { name: "Leather Tote", priceAmount: 7900, currency: "USD" },
    });
    expect((await recentObservations(db, context, { kind: "price" })).map((o) => o.id)).toEqual([
      price.id,
    ]);

    // Ideas from the observations, each citing them, kept as suggestions.
    const drafted = await draftResearchIdeas(db, context, gateway(), { focus: "Totes" });
    expect(drafted).toEqual({ ok: true, count: 2 });
    const ideas = await listIdeas(db, context);
    expect(ideas).toHaveLength(2);
    expect(ideas[0]).toMatchObject({ origin: "ai_generated", status: "new", model: "mock" });
    expect(ideas.flatMap((i) => i.cites.map((c) => c.competitor))).toEqual([
      "Bag House",
      "Bag House",
    ]);

    await decideIdea(db, context, ideas[0]!.id, "accepted");
    expect((await listIdeas(db, context, { status: "accepted" })).map((i) => i.id)).toEqual([
      ideas[0]!.id,
    ]);
    await expect(decideIdea(db, context, ideas[1]!.id, "maybe")).rejects.toThrow(/keep or dismiss/);

    // A deleted observation disappears from the ideas citing it.
    await deleteObservation(db, context, price.id);
    const after = await listIdeas(db, context, { status: "accepted" });
    expect(after[0]!.cites.every((c) => c.id !== price.id)).toBe(true);

    // Archived competitors leave the list and the ideas' sources.
    await saveCompetitor(db, context, competitor.id, { name: "Bag House", archived: "on" });
    expect(await listCompetitors(db, context)).toHaveLength(0);
    expect(await listCompetitors(db, context, { archived: true })).toHaveLength(1);
    expect(await draftResearchIdeas(db, context, gateway())).toMatchObject({ ok: false });
  });

  it("needs research.write (and ai.use for ideas) and stays inside its store", async () => {
    const a = await store("a");
    const b = await store("b");
    const owner = a.as("store_owner");
    const competitor = await saveCompetitor(owner.db, owner.context, null, { name: "Rival" });
    const service = a.as("customer_service");
    await expect(listCompetitors(service.db, service.context)).rejects.toThrow(ForbiddenError);
    const manager = a.as("store_manager");
    expect(await listCompetitors(manager.db, manager.context)).toHaveLength(1);
    const other = b.as("store_owner");
    await expect(getCompetitor(other.db, other.context, competitor.id)).rejects.toThrow(
      /not found/i,
    );
    await expect(
      addObservation(other.db, other.context, competitor.id, { kind: "post", title: "x" }),
    ).rejects.toThrow(/not found/i);
    // Another store's product cannot be compared.
    const mine = await saveCompetitor(other.db, other.context, null, { name: "Rival" });
    await expect(
      addObservation(other.db, other.context, mine.id, {
        kind: "price",
        title: "x",
        productId: a.productId,
      }),
    ).rejects.toThrow(/no longer exists/);
  });
});
