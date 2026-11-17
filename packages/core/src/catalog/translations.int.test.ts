import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { loadStorefront, storeLanguages } from "../tenancy/store-host";
import { getPublicCategory, getPublicProduct, listPublicProducts } from "./public";
import {
  getProductTranslation,
  localizeCategory,
  localizeProduct,
  localizeProducts,
  productNamesBySlug,
  saveCategoryTranslation,
  saveProductTranslation,
} from "./translations";

// Arabic wording for products and categories, against the real (test)
// database on the runtime connection.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.80",
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
    data: { name: `Lang ${label} ${run}`, slug: `lang-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main", languages: ["en", "ar"] },
  });
  const user = await admin.user.create({
    data: { email: `lang-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const category = await admin.category.create({
    data: { tenantId: tenant.id, name: "Bags", slug: "bags", description: "All our bags." },
  });
  const product = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: "Leather Tote",
      slug: "leather-tote",
      shortDescription: "A roomy tote.",
      description: "Made of leather.",
      categoryId: category.id,
      status: "active",
    },
  });
  await admin.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `LANG-${label}-${run}`,
      priceAmount: 5000,
      currency: "USD",
    },
  });
  const owner = contextFor(tenant.id, user.id, "store_owner");
  return {
    tenantId: tenant.id,
    categoryId: category.id,
    productId: product.id,
    owner,
    db: createTenantDb(app, owner),
    shop: createTenantDb(app, { tenantId: tenant.id }),
  };
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("product and category translations", () => {
  it("show Arabic wording where written and the default wording elsewhere", async () => {
    const s = await store("show");
    await saveProductTranslation(s.db, s.owner, s.productId, "ar", {
      name: "حقيبة جلدية",
      shortDescription: "",
      description: "مصنوعة من الجلد.",
    });
    await saveCategoryTranslation(s.db, s.owner, s.categoryId, "ar", { name: "حقائب" });

    const product = await getPublicProduct(s.shop, "leather-tote");
    const arabic = await localizeProduct(s.shop, "ar", product);
    expect(arabic).toMatchObject({
      name: "حقيبة جلدية",
      // Left empty: the English shows.
      shortDescription: "A roomy tote.",
      description: "مصنوعة من الجلد.",
      category: { name: "حقائب" },
    });
    // English shoppers see the product's own wording.
    expect(await localizeProduct(s.shop, "en", product)).toEqual(product);

    const list = await listPublicProducts(s.shop, {});
    expect((await localizeProducts(s.shop, "ar", list.items, (p) => p.id))[0]!.name).toBe(
      "حقيبة جلدية",
    );
    expect((await productNamesBySlug(s.shop, "ar", ["leather-tote"])).get("leather-tote")).toBe(
      "حقيبة جلدية",
    );
    const category = await localizeCategory(s.shop, "ar", await getPublicCategory(s.shop, "bags"));
    expect(category).toMatchObject({ name: "حقائب", description: "All our bags." });

    // Searching in Arabic finds the product.
    expect((await listPublicProducts(s.shop, { search: "حقيبة" })).total).toBe(1);

    // Saving everything empty removes the translation.
    await saveProductTranslation(s.db, s.owner, s.productId, "ar", { name: " " });
    expect(await getProductTranslation(s.db, s.owner, s.productId, "ar")).toEqual({
      name: "",
      shortDescription: "",
      description: "",
    });
  });

  it("belong to one store and need catalog.write", async () => {
    const a = await store("a");
    const b = await store("b");
    await saveProductTranslation(a.db, a.owner, a.productId, "ar", { name: "حقيبة أ" });
    // Store B cannot see or change store A's product.
    await expect(
      saveProductTranslation(b.db, b.owner, a.productId, "ar", { name: "x" }),
    ).rejects.toThrow();
    expect(await productNamesBySlug(b.shop, "ar", ["leather-tote"])).toEqual(new Map());
    // The database refuses a translation pointing at another store's product.
    await expect(
      admin.productTranslation.create({
        data: { tenantId: b.tenantId, productId: a.productId, locale: "ar", name: "x" },
      }),
    ).rejects.toThrow();

    const marketer = contextFor(a.tenantId, a.owner.userId!, "marketer");
    await expect(
      saveProductTranslation(createTenantDb(app, marketer), marketer, a.productId, "ar", {
        name: "x",
      }),
    ).rejects.toThrow(ForbiddenError);
    // Only Arabic translations: English is the product's own wording.
    await expect(
      saveProductTranslation(a.db, a.owner, a.productId, "en", { name: "x" }),
    ).rejects.toThrow(/language/);
  });

  it("the store's languages reach the shop, default first", async () => {
    const s = await store("langs");
    const domain = `lang-${run}.example.test`;
    const storeRow = await admin.store.findFirstOrThrow({ where: { tenantId: s.tenantId } });
    await admin.storeDomain.create({
      data: { tenantId: s.tenantId, storeId: storeRow.id, hostname: domain, isPrimary: true },
    });
    const shop = await loadStorefront(app, domain);
    expect(shop).toMatchObject({ defaultLocale: "en", languages: ["en", "ar"] });
    expect(storeLanguages("xx", ["ar"])).toEqual({ defaultLocale: "en", languages: ["en", "ar"] });
    expect(storeLanguages("en", [])).toEqual({ defaultLocale: "en", languages: ["en"] });
    // A language outside the list is refused by the database.
    await expect(
      admin.store.update({ where: { id: storeRow.id }, data: { languages: ["en", "fr"] } }),
    ).rejects.toThrow();
  });
});
