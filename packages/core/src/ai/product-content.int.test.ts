import { randomUUID } from "node:crypto";
import { createGateway, createMockProvider, dollarsToMicros } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { CatalogError } from "../catalog/errors";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createAiLedger, saveAiSettings } from "./ai-admin";
import {
  applyProductSuggestion,
  dismissProductSuggestion,
  draftProductCopy,
  draftProductTranslation,
  listProductSuggestions,
} from "./product-content";

// AI drafts for products against the real (test) database, on the runtime
// connection, with the mock provider (no outside calls).

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.91",
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
    data: { name: `Copy ${label} ${run}`, slug: `copy-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Cedar ${label}`, slug: "main", languages: ["en", "ar"] },
  });
  const user = await admin.user.create({
    data: { email: `copy-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const bags = await admin.category.create({
    data: { tenantId: tenant.id, name: "Tote Bag", slug: "tote-bag" },
  });
  await admin.category.create({ data: { tenantId: tenant.id, name: "Scarves", slug: "scarves" } });
  const brand = await admin.brand.create({
    data: { tenantId: tenant.id, name: "Cedar Leather", slug: "cedar-leather" },
  });
  const product = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: "Leather Tote Bag",
      slug: "leather-tote",
      brandId: brand.id,
      audienceTags: ["gifts"],
      material: "Full-grain leather",
      description: "A roomy tote for every day.",
      seoTitle: "Old search title",
      attributes: {
        create: [{ tenantId: tenant.id, key: "Width", value: "38 cm", position: 0 }],
      },
    },
  });
  const ctx = (role: SystemRoleKey) => {
    const context = contextFor(tenant.id, user.id, role);
    return { context, db: createTenantDb(app, context) };
  };
  return { tenantId: tenant.id, userId: user.id, productId: product.id, bagsId: bags.id, ctx };
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

describe("AI drafts for products", () => {
  it("drafts wording, search text, tags and a category, and a new draft replaces the old", async () => {
    const s = await store("draft");
    const { context, db } = s.ctx("content_editor");
    const first = await draftProductCopy(db, context, gatewayFor(s.userId), s.productId);
    expect(first.ok).toBe(true);
    const [draft] = await listProductSuggestions(db, context, s.productId);
    expect(draft).toMatchObject({ kind: "copy", locale: "en", categoryName: "Tote Bag" });
    if (draft?.kind !== "copy") throw new Error("expected a copy draft");
    expect(draft.proposal.categoryId).toBe(s.bagsId);
    expect(draft.proposal.description).toContain("38 cm");
    expect(draft.proposal.seoTitle.length).toBeLessThanOrEqual(60);
    expect(draft.proposal.tags).toEqual(expect.arrayContaining(["cedar leather", "gifts"]));

    // The draft points at its AI run, which recorded what was sent.
    const row = await admin.productSuggestion.findUniqueOrThrow({ where: { id: draft.id } });
    const event = await admin.aiEvent.findUniqueOrThrow({ where: { id: row.aiEventId! } });
    expect(event).toMatchObject({ task: "item.copy", status: "ok", route: "needs_approval" });

    const second = await draftProductCopy(db, context, gatewayFor(s.userId), s.productId);
    expect(second.ok).toBe(true);
    const pending = await listProductSuggestions(db, context, s.productId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).not.toBe(draft.id);
    const replaced = await admin.productSuggestion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(replaced.status).toBe("replaced");

    // Nothing on the product changed by itself.
    const product = await admin.product.findUniqueOrThrow({ where: { id: s.productId } });
    expect(product).toMatchObject({ seoTitle: "Old search title", categoryId: null });
  });

  it("applies only the parts staff tick, adds tags to the product's own, and records it", async () => {
    const s = await store("apply");
    const { context, db } = s.ctx("store_owner");
    await draftProductCopy(db, context, gatewayFor(s.userId), s.productId);
    const [draft] = await listProductSuggestions(db, context, s.productId);
    if (draft?.kind !== "copy") throw new Error("expected a copy draft");

    await expect(
      applyProductSuggestion(db, context, s.productId, draft.id, []),
    ).rejects.toBeInstanceOf(CatalogError);
    await applyProductSuggestion(db, context, s.productId, draft.id, [
      "description",
      "tags",
      "category",
      "not-a-field",
    ]);
    const product = await admin.product.findUniqueOrThrow({ where: { id: s.productId } });
    expect(product.description).toBe(draft.proposal.description);
    expect(product.seoTitle).toBe("Old search title");
    expect(product.categoryId).toBe(s.bagsId);
    expect(product.audienceTags[0]).toBe("gifts");
    expect(new Set(product.audienceTags).size).toBe(product.audienceTags.length);

    const decided = await admin.productSuggestion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(decided).toMatchObject({
      status: "applied",
      appliedFields: ["description", "tags", "category"],
      decidedByUserId: s.userId,
    });
    const entry = await admin.auditLog.findFirstOrThrow({
      where: { tenantId: s.tenantId, action: "ai.product_draft_applied" },
    });
    expect(entry.entityId).toBe(s.productId);
    await expect(
      applyProductSuggestion(db, context, s.productId, draft.id, ["description"]),
    ).rejects.toThrow(/already applied/);
  });

  it("drafts Arabic wording and replaces only the chosen parts of the translation", async () => {
    const s = await store("arabic");
    const { context, db } = s.ctx("store_manager");
    await admin.productTranslation.create({
      data: {
        tenantId: s.tenantId,
        productId: s.productId,
        locale: "ar",
        name: "",
        description: "وصف كتبه الفريق",
      },
    });
    const result = await draftProductTranslation(
      db,
      context,
      gatewayFor(s.userId),
      s.productId,
      "ar",
    );
    expect(result.ok).toBe(true);
    const [draft] = await listProductSuggestions(db, context, s.productId);
    if (draft?.kind !== "translation") throw new Error("expected a translation draft");
    expect(draft.locale).toBe("ar");
    expect(draft.proposal.name).toContain("Leather Tote Bag");

    await applyProductSuggestion(db, context, s.productId, draft.id, ["name"]);
    const translation = await admin.productTranslation.findUniqueOrThrow({
      where: { productId_locale: { productId: s.productId, locale: "ar" } },
    });
    expect(translation.name).toBe(draft.proposal.name);
    expect(translation.description).toBe("وصف كتبه الفريق");

    await expect(
      draftProductTranslation(db, context, gatewayFor(s.userId), s.productId, "fr"),
    ).rejects.toBeInstanceOf(CatalogError);
  });

  it("dismisses a draft without touching the product", async () => {
    const s = await store("dismiss");
    const { context, db } = s.ctx("store_owner");
    await draftProductCopy(db, context, gatewayFor(s.userId), s.productId);
    const [draft] = await listProductSuggestions(db, context, s.productId);
    await dismissProductSuggestion(db, context, s.productId, draft!.id);
    expect(await listProductSuggestions(db, context, s.productId)).toEqual([]);
    const product = await admin.product.findUniqueOrThrow({ where: { id: s.productId } });
    expect(product.description).toBe("A roomy tote for every day.");
  });

  it("makes no draft while AI is paused, and says why", async () => {
    const s = await store("paused");
    const owner = s.ctx("store_owner");
    await saveAiSettings(owner.db, owner.context, {
      paused: "on",
      monthlyBudgetUsd: "",
      automation: "approval",
    });
    const result = await draftProductCopy(
      owner.db,
      owner.context,
      gatewayFor(s.userId),
      s.productId,
    );
    expect(result).toEqual({ ok: false, message: "AI is paused." });
    expect(await admin.productSuggestion.count({ where: { tenantId: s.tenantId } })).toBe(0);
  });

  it("needs both catalog editing and AI use", async () => {
    const s = await store("roles");
    const owner = s.ctx("store_owner");
    await draftProductCopy(owner.db, owner.context, gatewayFor(s.userId), s.productId);
    const [draft] = await listProductSuggestions(owner.db, owner.context, s.productId);

    // Inventory managers edit products but do not use AI; marketers use AI but do not edit products.
    for (const role of ["inventory_manager", "marketer"] as const) {
      const { context, db } = s.ctx(role);
      await expect(
        draftProductCopy(db, context, gatewayFor(s.userId), s.productId),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        applyProductSuggestion(db, context, s.productId, draft!.id, ["description"]),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const inventory = s.ctx("inventory_manager");
    expect(await listProductSuggestions(inventory.db, inventory.context, s.productId)).toEqual([]);
  });

  it("keeps each store's drafts to itself", async () => {
    const a = await store("iso-a");
    const b = await store("iso-b");
    const ownerA = a.ctx("store_owner");
    const ownerB = b.ctx("store_owner");
    await draftProductCopy(ownerA.db, ownerA.context, gatewayFor(a.userId), a.productId);
    const [draft] = await listProductSuggestions(ownerA.db, ownerA.context, a.productId);

    expect(await listProductSuggestions(ownerB.db, ownerB.context, a.productId)).toEqual([]);
    await expect(
      applyProductSuggestion(ownerB.db, ownerB.context, a.productId, draft!.id, ["description"]),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      dismissProductSuggestion(ownerB.db, ownerB.context, a.productId, draft!.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      draftProductCopy(ownerB.db, ownerB.context, gatewayFor(b.userId), a.productId),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Even the owner connection cannot file a draft under another store's product.
    await expect(
      admin.productSuggestion.create({
        data: {
          tenantId: b.tenantId,
          productId: a.productId,
          kind: "copy",
          locale: "en",
          proposal: {},
        },
      }),
    ).rejects.toThrow(/same tenant|Foreign key/);
  });
});
