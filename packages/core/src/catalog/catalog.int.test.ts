import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { seedSystemData } from "../identity/seed";
import { createBrand, deleteBrand, listBrands, updateBrand } from "./brands";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from "./categories";
import { seedDemoCatalog } from "./demo-seed";
import { CatalogError, type CatalogErrorCode } from "./errors";
import {
  addVariant,
  createProduct,
  deleteVariant,
  getProduct,
  getVariant,
  listProducts,
  setProductStatus,
  updateProduct,
  updateVariant,
} from "./products";

// Catalog services against the real (test) database, on the runtime
// connection, so Row-Level Security is in force exactly as in production.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);

interface Actor {
  context: RequestContext;
  db: TenantDb;
}

const tenantIds: string[] = [];
const userIds: string[] = [];

async function createTenant(label: string, currency = "USD") {
  const tenant = await admin.tenant.create({
    data: { name: `Catalog ${label} ${run}`, slug: `catalog-${label}-${run}` },
  });
  const store = await admin.store.create({
    data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main", defaultCurrency: currency },
  });
  tenantIds.push(tenant.id);
  return { tenantId: tenant.id, storeId: store.id };
}

async function createActor(
  tenant: { tenantId: string; storeId: string },
  role: SystemRoleKey,
): Promise<Actor> {
  const user = await admin.user.create({
    data: { email: `catalog-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId: tenant.tenantId, roleId: roleRow.id },
  });
  const permissions = SYSTEM_ROLES.find((r) => r.key === role)!.permissions;
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.20",
    userId: user.id,
    isPlatformAdmin: false,
    tenantId: tenant.tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: tenant.storeId,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(permissions as readonly PermissionKey[]),
  };
  return { context, db: createTenantDb(app, context) };
}

async function expectCatalogError(work: Promise<unknown>, code: CatalogErrorCode) {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected CatalogError ${code}`).toBeInstanceOf(CatalogError);
  expect((error as CatalogError).code).toBe(code);
}

const price = (amount: number, extra: Record<string, unknown> = {}) => ({
  sku: `SKU-${randomUUID().slice(0, 8)}`,
  priceAmount: amount,
  ...extra,
});

let owner: Actor; // tenant A, can read and write
let marketer: Actor; // tenant A, can read only
let support: Actor; // tenant A, customer service: read only
let other: Actor; // tenant B owner
let tenantA: { tenantId: string; storeId: string };
let tenantB: { tenantId: string; storeId: string };

beforeAll(async () => {
  await seedSystemData(admin);
  tenantA = await createTenant("a");
  tenantB = await createTenant("b", "JPY");
  owner = await createActor(tenantA, "store_owner");
  marketer = await createActor(tenantA, "marketer");
  support = await createActor(tenantA, "customer_service");
  other = await createActor(tenantB, "store_owner");
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("categories", () => {
  it("creates a tree and lists it parents-first with counts", async () => {
    const bags = await createCategory(owner.db, owner.context, { name: "Bags", position: 1 });
    const totes = await createCategory(owner.db, owner.context, {
      name: "Tote Bags",
      parentId: bags.id,
    });
    await createCategory(owner.db, owner.context, { name: "Accessories", position: 0 });

    const list = await listCategories(owner.db, owner.context);
    expect(list.map((c) => `${c.depth}:${c.slug}`)).toEqual([
      "0:accessories",
      "0:bags",
      "1:tote-bags",
    ]);
    expect(list.find((c) => c.id === bags.id)?.childCount).toBe(1);
    expect((await getCategory(owner.db, owner.context, totes.id)).parentId).toBe(bags.id);
  });

  it("refuses a duplicate URL name in the same tenant but allows it in another", async () => {
    await expectCatalogError(
      createCategory(owner.db, owner.context, { name: "Other", slug: "bags" }),
      "slug_taken",
    );
    await expect(createCategory(other.db, other.context, { name: "Bags" })).resolves.toHaveProperty(
      "id",
    );
  });

  it("validates names and URL names", async () => {
    await expectCatalogError(createCategory(owner.db, owner.context, { name: "  " }), "invalid");
    await expectCatalogError(
      createCategory(owner.db, owner.context, { name: "X", slug: "Not A Slug" }),
      "invalid",
    );
    // A name with no Latin letters cannot produce a URL name by itself.
    await expectCatalogError(createCategory(owner.db, owner.context, { name: "حقائب" }), "invalid");
    await expect(
      createCategory(owner.db, owner.context, { name: "حقائب", slug: "haqaeb" }),
    ).resolves.toHaveProperty("id");
  });

  it("refuses loops in the tree", async () => {
    const list = await listCategories(owner.db, owner.context);
    const bags = list.find((c) => c.slug === "bags")!;
    const totes = list.find((c) => c.slug === "tote-bags")!;
    await expectCatalogError(
      updateCategory(owner.db, owner.context, bags.id, { name: "Bags", parentId: bags.id }),
      "parent_cycle",
    );
    await expectCatalogError(
      updateCategory(owner.db, owner.context, bags.id, { name: "Bags", parentId: totes.id }),
      "parent_cycle",
    );
  });

  it("refuses a parent from another tenant, exactly like one that does not exist", async () => {
    const [foreign] = await listCategories(other.db, other.context);
    await expectCatalogError(
      createCategory(owner.db, owner.context, { name: "Sneaky", parentId: foreign!.id }),
      "unknown_reference",
    );
    await expectCatalogError(
      createCategory(owner.db, owner.context, { name: "Sneaky", parentId: randomUUID() }),
      "unknown_reference",
    );
  });

  it("will not delete a category that has sub-categories", async () => {
    const list = await listCategories(owner.db, owner.context);
    const bags = list.find((c) => c.slug === "bags")!;
    await expectCatalogError(deleteCategory(owner.db, owner.context, bags.id), "has_children");
  });
});

describe("brands", () => {
  it("creates, renames, lists and deletes", async () => {
    const brand = await createBrand(owner.db, owner.context, { name: "Atelier Nord" });
    await updateBrand(owner.db, owner.context, brand.id, { name: "Atelier Nord Co" });
    const list = await listBrands(owner.db, owner.context);
    expect(list.map((b) => `${b.name}|${b.slug}`)).toEqual(["Atelier Nord Co|atelier-nord-co"]);
    await expectCatalogError(
      createBrand(owner.db, owner.context, { name: "Copy", slug: "atelier-nord-co" }),
      "slug_taken",
    );
    await deleteBrand(owner.db, owner.context, brand.id);
    expect(await listBrands(owner.db, owner.context)).toEqual([]);
  });
});

describe("products and variants", () => {
  let productId: string;
  let firstVariantId: string;

  it("creates a draft product", async () => {
    const [category] = await listCategories(owner.db, owner.context);
    const created = await createProduct(owner.db, owner.context, {
      name: "Crème Leather Tote",
      categoryId: category!.id,
    });
    productId = created.id;
    const product = await getProduct(owner.db, owner.context, productId);
    expect(product).toMatchObject({
      slug: "creme-leather-tote",
      status: "draft",
      categoryId: category!.id,
      variants: [],
    });
  });

  it("cannot be published without an active variant", async () => {
    await expectCatalogError(
      setProductStatus(owner.db, owner.context, productId, "active"),
      "needs_active_variant",
    );
  });

  it("adds variants priced in the store's currency", async () => {
    const variant = await addVariant(
      owner.db,
      owner.context,
      productId,
      price(8900, { sku: `TOTE-BLK-${run}`, color: "Black", discountPriceAmount: 7900 }),
    );
    firstVariantId = variant.id;
    const stored = await getVariant(owner.db, owner.context, variant.id);
    expect(stored).toMatchObject({
      currency: "USD",
      priceAmount: 8900,
      discountPriceAmount: 7900,
      color: "Black",
      status: "active",
      productName: "Crème Leather Tote",
    });

    const foreignProduct = await createProduct(other.db, other.context, { name: "Yen Thing" });
    const yen = await addVariant(other.db, other.context, foreignProduct.id, price(5000));
    expect((await getVariant(other.db, other.context, yen.id)).currency).toBe("JPY");
  });

  it("refuses invalid prices", async () => {
    const add = (extra: Record<string, unknown>) =>
      addVariant(owner.db, owner.context, productId, price(1000, extra));
    await expectCatalogError(add({ priceAmount: -1 }), "invalid");
    await expectCatalogError(add({ priceAmount: 10.5 }), "invalid");
    await expectCatalogError(add({ discountPriceAmount: 1000 }), "invalid");
    await expectCatalogError(add({ compareAtAmount: 900 }), "invalid");
    await expectCatalogError(add({ sku: "  " }), "invalid");
  });

  it("refuses a SKU already used in the tenant, but not across tenants", async () => {
    await expectCatalogError(
      addVariant(owner.db, owner.context, productId, price(1000, { sku: `TOTE-BLK-${run}` })),
      "sku_taken",
    );
    const foreign = await createProduct(other.db, other.context, { name: "Same SKU" });
    await expect(
      addVariant(other.db, other.context, foreign.id, price(1000, { sku: `TOTE-BLK-${run}` })),
    ).resolves.toHaveProperty("id");
  });

  it("publishes once there is something to sell, and records it in the audit log", async () => {
    await setProductStatus(owner.db, owner.context, productId, "active");
    expect((await getProduct(owner.db, owner.context, productId)).status).toBe("active");
    const entry = await admin.auditLog.findFirstOrThrow({
      where: { action: "catalog.product_status_changed", entityId: productId },
    });
    expect(entry).toMatchObject({
      tenantId: tenantA.tenantId,
      actorUserId: owner.context.userId,
      before: { status: "draft" },
      after: { status: "active" },
      requestId: `req-${run}`,
    });
  });

  it("keeps a published product sellable", async () => {
    const variant = await getVariant(owner.db, owner.context, firstVariantId);
    await expectCatalogError(
      updateVariant(owner.db, owner.context, firstVariantId, {
        sku: variant.sku,
        priceAmount: variant.priceAmount,
        status: "inactive",
      }),
      "last_active_variant",
    );
    await expectCatalogError(
      deleteVariant(owner.db, owner.context, firstVariantId),
      "last_active_variant",
    );

    const second = await addVariant(owner.db, owner.context, productId, price(9200));
    await deleteVariant(owner.db, owner.context, firstVariantId);
    const product = await getProduct(owner.db, owner.context, productId);
    expect(product.variants.map((v) => v.id)).toEqual([second.id]);
  });

  it("updates details, flags, tags and specifications together", async () => {
    await updateProduct(owner.db, owner.context, productId, {
      name: "Crème Leather Tote",
      slug: "creme-tote",
      shortDescription: "Roomy everyday tote.",
      audienceTags: ["Women", "women", "gift"],
      material: "Full-grain leather",
      isFeatured: true,
      attributes: [
        { key: "Strap length", value: "60 cm" },
        { key: "Closure", value: "Zip" },
      ],
    });
    const product = await getProduct(owner.db, owner.context, productId);
    expect(product).toMatchObject({
      slug: "creme-tote",
      audienceTags: ["women", "gift"],
      material: "Full-grain leather",
      isFeatured: true,
      isBestSeller: false,
      categoryId: null,
      attributes: [
        { key: "Strap length", value: "60 cm" },
        { key: "Closure", value: "Zip" },
      ],
    });

    await expectCatalogError(
      updateProduct(owner.db, owner.context, productId, {
        name: "X",
        attributes: [
          { key: "Size", value: "1" },
          { key: "size", value: "2" },
        ],
      }),
      "invalid",
    );
    // A failed update leaves the earlier specifications in place.
    expect((await getProduct(owner.db, owner.context, productId)).attributes).toHaveLength(2);
  });

  it("lists with search, status filter and the lowest active price", async () => {
    const draft = await createProduct(owner.db, owner.context, { name: "Hidden Wallet" });
    await addVariant(owner.db, owner.context, draft.id, price(3500, { sku: `WAL-${run}` }));

    const all = await listProducts(owner.db, owner.context);
    expect(all.total).toBe(2);
    const tote = all.items.find((item) => item.id === productId)!;
    expect(tote).toMatchObject({
      status: "active",
      variantCount: 1,
      priceFrom: { amount: 9200, currency: "USD" },
    });

    expect((await listProducts(owner.db, owner.context, { status: "draft" })).items).toHaveLength(
      1,
    );
    expect((await listProducts(owner.db, owner.context, { search: "crème" })).total).toBe(1);
    expect((await listProducts(owner.db, owner.context, { search: `wal-${run}` })).total).toBe(1);
    expect((await listProducts(owner.db, owner.context, { search: "nothing" })).total).toBe(0);
  });

  it("archives and restores", async () => {
    await setProductStatus(owner.db, owner.context, productId, "archived");
    expect((await getProduct(owner.db, owner.context, productId)).status).toBe("archived");
    await setProductStatus(owner.db, owner.context, productId, "active");
  });

  it("uncategorises products when their category is deleted", async () => {
    const category = await createCategory(owner.db, owner.context, { name: "Temporary" });
    const product = await createProduct(owner.db, owner.context, {
      name: "In Temporary",
      categoryId: category.id,
    });
    await deleteCategory(owner.db, owner.context, category.id);
    expect((await getProduct(owner.db, owner.context, product.id)).categoryId).toBeNull();
  });
});

describe("permissions", () => {
  it("lets read-only roles read but not write", async () => {
    for (const actor of [marketer, support]) {
      expect((await listProducts(actor.db, actor.context)).total).toBeGreaterThan(0);
      await expect(listCategories(actor.db, actor.context)).resolves.not.toHaveLength(0);
      await expect(createProduct(actor.db, actor.context, { name: "Nope" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        createCategory(actor.db, actor.context, { name: "Nope" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createBrand(actor.db, actor.context, { name: "Nope" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("refuses everything without catalog.read", async () => {
    const nobody: Actor = {
      db: owner.db,
      context: { ...owner.context, permissions: new Set<PermissionKey>() },
    };
    await expect(listProducts(nobody.db, nobody.context)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listBrands(nobody.db, nobody.context)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("tenant isolation", () => {
  it("shows each tenant only its own catalog", async () => {
    const mine = await listProducts(owner.db, owner.context);
    const theirs = await listProducts(other.db, other.context);
    const myIds = new Set(mine.items.map((item) => item.id));
    expect(theirs.items.some((item) => myIds.has(item.id))).toBe(false);
    expect(theirs.items.map((item) => item.name).sort()).toEqual(["Same SKU", "Yen Thing"]);
  });

  it("answers another tenant's records exactly like missing ones", async () => {
    const product = (await listProducts(owner.db, owner.context)).items.find(
      (item) => item.variantCount > 0,
    );
    const full = await getProduct(owner.db, owner.context, product!.id);
    const variantId = full.variants[0]!.id;
    const [category] = await listCategories(owner.db, owner.context);

    const attempts: (() => Promise<unknown>)[] = [
      () => getProduct(other.db, other.context, product!.id),
      () => updateProduct(other.db, other.context, product!.id, { name: "Hacked" }),
      () => setProductStatus(other.db, other.context, product!.id, "archived"),
      () => addVariant(other.db, other.context, product!.id, price(1)),
      () => getVariant(other.db, other.context, variantId),
      () => updateVariant(other.db, other.context, variantId, price(1)),
      () => deleteVariant(other.db, other.context, variantId),
      () => getCategory(other.db, other.context, category!.id),
      () => updateCategory(other.db, other.context, category!.id, { name: "Hacked" }),
      () => deleteCategory(other.db, other.context, category!.id),
      () => getProduct(other.db, other.context, randomUUID()),
      () => getProduct(other.db, other.context, "not-an-id"),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);

    const untouched = await getProduct(owner.db, owner.context, product!.id);
    expect(untouched.name).toBe(full.name);
    expect(untouched.variants).toHaveLength(full.variants.length);
  });

  it("refuses to attach another tenant's category or brand to a product", async () => {
    const [foreignCategory] = await listCategories(other.db, other.context);
    const foreignBrand = await createBrand(other.db, other.context, { name: "Foreign Brand" });
    await expectCatalogError(
      createProduct(owner.db, owner.context, { name: "X1", categoryId: foreignCategory!.id }),
      "unknown_reference",
    );
    await expectCatalogError(
      createProduct(owner.db, owner.context, { name: "X2", brandId: foreignBrand.id }),
      "unknown_reference",
    );
  });

  it("is enforced by the database even if application code forgets", async () => {
    const asA = <T>(work: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(app, { tenantId: tenantA.tenantId }, work);
    const [foreignCategory] = await listCategories(other.db, other.context);
    const [foreignProduct] = (await listProducts(other.db, other.context)).items;
    const [ownProduct] = (await listProducts(owner.db, owner.context)).items;

    // Reads and writes by id reach nothing in tenant B.
    expect(
      await asA((tx) => tx.product.findUnique({ where: { id: foreignProduct!.id } })),
    ).toBeNull();
    expect(
      await asA((tx) =>
        tx.product.updateMany({ where: { id: foreignProduct!.id }, data: { name: "x" } }),
      ),
    ).toEqual({ count: 0 });
    expect(
      await asA((tx) => tx.productVariant.deleteMany({ where: { productId: foreignProduct!.id } })),
    ).toEqual({ count: 0 });
    expect((await listProducts(other.db, other.context)).items[0]!.variantCount).toBe(1);

    // Rows cannot be created for, or moved into, tenant B.
    await expect(
      asA((tx) =>
        tx.brand.create({ data: { tenantId: tenantB.tenantId, name: "x", slug: `x-${run}` } }),
      ),
    ).rejects.toThrow();

    // A foreign key alone would accept these; the same-tenant triggers do not.
    await expect(
      asA((tx) =>
        tx.product.update({
          where: { id: ownProduct!.id },
          data: { categoryId: foreignCategory!.id },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      admin.productVariant.create({
        data: {
          tenantId: tenantA.tenantId,
          productId: foreignProduct!.id,
          sku: `cross-${run}`,
          priceAmount: 1,
          currency: "USD",
        },
      }),
    ).rejects.toThrow();
    await expect(
      admin.category.create({
        data: {
          tenantId: tenantA.tenantId,
          parentId: foreignCategory!.id,
          name: "x",
          slug: `cross-${run}`,
        },
      }),
    ).rejects.toThrow();
  });

  it("sees nothing without a tenant context", async () => {
    expect(await app.product.findMany()).toEqual([]);
    expect(await app.category.findMany()).toEqual([]);
    expect(await app.productVariant.findMany()).toEqual([]);
  });
});

describe("database constraints", () => {
  const variant = (data: Record<string, unknown>) =>
    admin.productVariant.create({
      data: {
        tenantId: tenantA.tenantId,
        productId: "",
        sku: `chk-${randomUUID().slice(0, 8)}`,
        priceAmount: 1000,
        currency: "USD",
        ...data,
      } as never,
    });

  it("reject bad values even from the owner connection", async () => {
    const product = await admin.product.create({
      data: { tenantId: tenantA.tenantId, name: "Constraint", slug: `constraint-${run}` },
    });
    const base = { productId: product.id };
    await expect(variant({ ...base, priceAmount: -1 })).rejects.toThrow();
    await expect(variant({ ...base, discountPriceAmount: 1000 })).rejects.toThrow();
    await expect(variant({ ...base, compareAtAmount: 1000 })).rejects.toThrow();
    await expect(variant({ ...base, currency: "usd" })).rejects.toThrow();
    await expect(variant({ ...base, sku: " padded " })).rejects.toThrow();
    await expect(variant({ ...base, weightGrams: -5 })).rejects.toThrow();
    await expect(
      admin.product.create({
        data: { tenantId: tenantA.tenantId, name: "Bad", slug: "Bad Slug" },
      }),
    ).rejects.toThrow();
    await expect(
      admin.category.create({
        data: { tenantId: tenantA.tenantId, name: " ", slug: `blank-${run}` },
      }),
    ).rejects.toThrow();
  });
});

describe("demo catalog seed", () => {
  it("fills an empty tenant once and never overwrites", async () => {
    const tenant = await createTenant("demo");
    const db: TenantDb = {
      tenantId: tenant.tenantId,
      run: (work) => withTenant(app, { tenantId: tenant.tenantId }, work),
    };
    expect(await seedDemoCatalog(db)).toEqual({ created: true, categories: 5, products: 2 });
    expect(await seedDemoCatalog(db)).toEqual({ created: false, categories: 0, products: 0 });
    expect(await admin.product.count({ where: { tenantId: tenant.tenantId } })).toBe(2);
    expect(await admin.productVariant.count({ where: { tenantId: tenant.tenantId } })).toBe(3);
  });
});
