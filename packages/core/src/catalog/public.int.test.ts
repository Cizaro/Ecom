import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import {
  getPublicCategory,
  getPublicProduct,
  listPublicProducts,
  listPublicProductsBySlug,
  listRelatedProducts,
  listTopCategories,
  type PublicListInput,
} from "./public";

// What shoppers can see, against the real (test) database on the runtime
// connection. The data is written with the admin connection; every read goes
// through the public services inside one tenant.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];

let shopA: TenantDb;
let shopB: TenantDb;
let tenantA: string;
let tenantB: string;
let bags: string;
let totes: string;

async function createTenant(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Public ${label} ${run}`, slug: `public-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

interface VariantSeed {
  color?: string;
  price: number;
  sale?: number;
  status?: "active" | "inactive";
  sku?: string;
}

async function product(
  tenantId: string,
  name: string,
  variants: VariantSeed[],
  extra: Record<string, unknown> = {},
) {
  const row = await admin.product.create({
    data: {
      tenantId,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      status: "active",
      ...extra,
    },
  });
  for (const [position, variant] of variants.entries()) {
    await admin.productVariant.create({
      data: {
        tenantId,
        productId: row.id,
        sku: variant.sku ?? `SKU-${randomUUID().slice(0, 8)}`,
        color: variant.color ?? null,
        priceAmount: variant.price,
        discountPriceAmount: variant.sale ?? null,
        // A cost on every variant: it must never appear in any public result.
        costAmount: 1234,
        currency: "USD",
        status: variant.status ?? "active",
        position,
      },
    });
  }
  return row;
}

const names = async (db: TenantDb, input: PublicListInput = {}) =>
  (await listPublicProducts(db, input)).items.map((item) => item.name);

beforeAll(async () => {
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  shopA = createTenantDb(app, { tenantId: tenantA });
  shopB = createTenantDb(app, { tenantId: tenantB });

  const bagsRow = await admin.category.create({
    data: { tenantId: tenantA, name: "Bags", slug: "bags", description: "All bags.", position: 1 },
  });
  const totesRow = await admin.category.create({
    data: { tenantId: tenantA, name: "Totes", slug: "totes", parentId: bagsRow.id },
  });
  await admin.category.create({
    data: { tenantId: tenantA, name: "Accessories", slug: "accessories", position: 0 },
  });
  await admin.category.create({ data: { tenantId: tenantB, name: "Hidden", slug: "hidden" } });
  bags = bagsRow.id;
  totes = totesRow.id;
  const aria = await admin.brand.create({
    data: { tenantId: tenantA, name: "Aria", slug: "aria" },
  });
  const nord = await admin.brand.create({
    data: { tenantId: tenantA, name: "Nord", slug: "nord" },
  });

  const base = Date.now();
  const at = (minutesAgo: number) => ({ createdAt: new Date(base - minutesAgo * 60_000) });

  await product(
    tenantA,
    "Classic Leather Tote",
    [
      { color: "Black", price: 10000, sku: `TOTE-BLK-${run}` },
      { color: "Tan", price: 12000, sale: 9000 },
      { color: "Red", price: 500, status: "inactive" },
    ],
    {
      categoryId: totes,
      brandId: aria.id,
      isFeatured: true,
      shortDescription: "Roomy everyday carryall.",
      material: "Full-grain leather",
      ...at(30),
    },
  );
  await product(tenantA, "City Backpack", [{ color: "Navy", price: 5000 }], {
    categoryId: bags,
    brandId: nord.id,
    isNewArrival: true,
    ...at(20),
  });
  await product(tenantA, "Slim Wallet", [{ color: "black", price: 2000 }], at(10));
  await product(tenantA, "Secret Tote", [{ price: 100 }], { categoryId: totes, status: "draft" });
  await product(tenantA, "Old Tote", [{ price: 100 }], { categoryId: totes, status: "archived" });
  // Marked published but with nothing for sale.
  await product(tenantA, "Ghost Tote", [{ price: 100, status: "inactive" }], {
    categoryId: totes,
  });
  await product(tenantB, "Other Leather Tote", [{ color: "Black", price: 7000 }], {
    isFeatured: true,
  });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await disconnectDatabase();
});

describe("what a shopper can see", () => {
  it("lists only published products with something for sale, in this store", async () => {
    expect(await names(shopA)).toEqual(["Slim Wallet", "City Backpack", "Classic Leather Tote"]);
    expect(await names(shopB)).toEqual(["Other Leather Tote"]);
  });

  it("never includes a cost price", async () => {
    const everything = [
      await listPublicProducts(shopA),
      await getPublicProduct(shopA, "classic-leather-tote"),
    ];
    const text = JSON.stringify(everything);
    expect(text).not.toMatch(/cost/i);
    expect(text).not.toContain("1234");
  });

  it("shows the current price, the regular price when on sale, and the colours for sale", async () => {
    const list = await listPublicProducts(shopA);
    const tote = list.items.find((item) => item.name === "Classic Leather Tote")!;
    expect(tote).toMatchObject({
      priceAmount: 9000,
      regularPriceAmount: 12000,
      priceVaries: true,
      currency: "USD",
      brandName: "Aria",
      colors: ["Black", "Tan"], // the inactive red variant is not offered
      image: null,
    });
    const wallet = list.items.find((item) => item.name === "Slim Wallet")!;
    expect(wallet).toMatchObject({
      priceAmount: 2000,
      regularPriceAmount: null,
      priceVaries: false,
    });
  });

  it("includes sub-categories when listing a category", async () => {
    expect(await names(shopA, { categoryId: bags })).toEqual([
      "City Backpack",
      "Classic Leather Tote",
    ]);
    expect(await names(shopA, { categoryId: totes })).toEqual(["Classic Leather Tote"]);
    // Another store asking with this store's category ID gets nothing.
    expect(await names(shopB, { categoryId: bags })).toEqual([]);
  });

  it("filters by flag, brand, colour and price", async () => {
    expect(await names(shopA, { flag: "featured" })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { flag: "new" })).toEqual(["City Backpack"]);
    expect(await names(shopA, { flag: "best_seller" })).toEqual([]);
    expect(await names(shopA, { brandSlugs: ["nord"] })).toEqual(["City Backpack"]);
    expect(await names(shopA, { brandSlugs: ["nord", "aria"] })).toHaveLength(2);
    expect(await names(shopA, { colors: ["BLACK"] })).toEqual([
      "Slim Wallet",
      "Classic Leather Tote",
    ]);
    // Only colours actually for sale count.
    expect(await names(shopA, { colors: ["red"] })).toEqual([]);
    expect(await names(shopA, { priceMin: 2001, priceMax: 9000 })).toEqual([
      "City Backpack",
      "Classic Leather Tote",
    ]);
    expect(await names(shopA, { priceMax: 1999 })).toEqual([]);
  });

  it("sorts by price, name and newest", async () => {
    expect(await names(shopA, { sort: "price_asc" })).toEqual([
      "Slim Wallet",
      "City Backpack",
      "Classic Leather Tote",
    ]);
    expect(await names(shopA, { sort: "price_desc" })).toEqual([
      "Classic Leather Tote",
      "City Backpack",
      "Slim Wallet",
    ]);
    expect(await names(shopA, { sort: "name" })).toEqual([
      "City Backpack",
      "Classic Leather Tote",
      "Slim Wallet",
    ]);
    // "relevance" without a search falls back to newest; an unknown sort is ignored.
    expect(await names(shopA, { sort: "relevance" })).toEqual(await names(shopA));
    expect(await names(shopA, { sort: "DROP TABLE" as never })).toEqual(await names(shopA));
  });

  it("counts filter options over the whole list, not the filtered one", async () => {
    const { facets, total } = await listPublicProducts(shopA, { brandSlugs: ["nord"] });
    expect(total).toBe(1);
    expect(facets.brands).toEqual([
      { slug: "aria", name: "Aria", count: 1 },
      { slug: "nord", name: "Nord", count: 1 },
    ]);
    expect(facets.colors.map((c) => [c.value.toLowerCase(), c.count])).toEqual([
      ["black", 2],
      ["navy", 1],
      ["tan", 1],
    ]);
    expect(facets.price).toEqual({ min: 2000, max: 9000, currency: "USD" });

    const empty = await listPublicProducts(shopB, { categoryId: bags });
    expect(empty.facets).toEqual({ brands: [], colors: [], price: null });
  });

  it("pages through results and reports the total past the last page", async () => {
    const first = await listPublicProducts(shopA, { pageSize: 2 });
    expect(first).toMatchObject({ total: 3, page: 1, pageCount: 2 });
    expect(first.items).toHaveLength(2);
    const second = await listPublicProducts(shopA, { pageSize: 2, page: 2 });
    expect(second.items.map((item) => item.name)).toEqual(["Classic Leather Tote"]);
    const beyond = await listPublicProducts(shopA, { pageSize: 2, page: 40 });
    expect(beyond).toMatchObject({ total: 3, pageCount: 2 });
    expect(beyond.items).toEqual([]);
    // Nonsense paging is clamped rather than failing.
    const odd = await listPublicProducts(shopA, { page: -3, pageSize: 100_000 });
    expect(odd).toMatchObject({ page: 1, pageSize: 48 });
  });
});

describe("search", () => {
  it("finds by words in the name and description, matching word beginnings", async () => {
    expect(await names(shopA, { search: "tote" })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { search: "tot" })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { search: "LEATHER  classic" })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { search: "carryall" })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { search: "full-grain" })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { search: "wallet tote" })).toEqual([]);
    expect(await names(shopA, { search: "zzzz" })).toEqual([]);
  });

  it("finds by SKU and by brand name", async () => {
    expect(await names(shopA, { search: `TOTE-BLK-${run}` })).toEqual(["Classic Leather Tote"]);
    expect(await names(shopA, { search: "nord" })).toEqual(["City Backpack"]);
  });

  it("never finds drafts, archived products, unsellable products or another store's", async () => {
    // "tote" appears in five product names across the two stores.
    const found = await listPublicProducts(shopA, { search: "tote" });
    expect(found.total).toBe(1);
    expect(await names(shopA, { search: "secret" })).toEqual([]);
    expect(await names(shopA, { search: "ghost" })).toEqual([]);
    expect(await names(shopA, { search: "other" })).toEqual([]);
    expect(await names(shopB, { search: "tote" })).toEqual(["Other Leather Tote"]);
  });

  it("treats anything a shopper types as plain words", async () => {
    const odd = [
      "'); DROP TABLE products; --",
      "tote | wallet",
      "!tote",
      "tote & :*",
      "<->",
      "%",
      "_",
      "\\",
      "' OR 1=1 --",
      "   ",
      "!!!",
      "a".repeat(5000),
      "ي".repeat(3),
    ];
    for (const search of odd) {
      const result = await listPublicProducts(shopA, { search });
      expect(result.total, search).toBeLessThanOrEqual(3);
    }
    // "tote | wallet" means both words, not either.
    expect(await names(shopA, { search: "tote | wallet" })).toEqual([]);
    // A bare wildcard is not a search term, so it matches as "no search".
    expect((await listPublicProducts(shopA, { search: "%" })).total).toBe(3);
    expect(await admin.product.count({ where: { tenantId: tenantA } })).toBe(6);
  });

  it("follows a product when its name changes", async () => {
    await admin.product.updateMany({
      where: { tenantId: tenantA, slug: "slim-wallet" },
      data: { name: "Slim Cardholder" },
    });
    expect(await names(shopA, { search: "cardholder" })).toEqual(["Slim Cardholder"]);
    expect(await names(shopA, { search: "wallet" })).toEqual([]);
    await admin.product.updateMany({
      where: { tenantId: tenantA, slug: "slim-wallet" },
      data: { name: "Slim Wallet" },
    });
  });

  it("puts the closest match first", async () => {
    await product(tenantA, "Travel Pouch", [{ price: 3000 }], {
      description: "Pairs well with a leather tote.",
    });
    expect(await names(shopA, { search: "tote" })).toEqual([
      "Classic Leather Tote",
      "Travel Pouch",
    ]);
    await admin.product.deleteMany({ where: { tenantId: tenantA, slug: "travel-pouch" } });
  });
});

describe("one product and one category", () => {
  it("returns a published product with only its variants for sale", async () => {
    const tote = await getPublicProduct(shopA, "classic-leather-tote");
    expect(tote).toMatchObject({
      name: "Classic Leather Tote",
      brandName: "Aria",
      category: { name: "Totes", slug: "totes" },
      material: "Full-grain leather",
    });
    expect(tote.variants.map((v) => [v.color, v.priceAmount, v.regularPriceAmount])).toEqual([
      ["Black", 10000, null],
      ["Tan", 9000, 12000],
    ]);
  });

  it("answers 'not found' for anything a shopper must not see", async () => {
    for (const slug of ["secret-tote", "old-tote", "ghost-tote", "other-leather-tote", "nope"]) {
      await expect(getPublicProduct(shopA, slug), slug).rejects.toBeInstanceOf(NotFoundError);
    }
    for (const slug of ["", "Classic Leather Tote", "../admin", "a".repeat(500), "%"]) {
      await expect(getPublicProduct(shopA, slug), slug).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(getPublicProduct(shopB, "classic-leather-tote")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("lists top-level categories in order and describes one with its tree", async () => {
    expect((await listTopCategories(shopA)).map((c) => c.slug)).toEqual(["accessories", "bags"]);
    expect((await listTopCategories(shopB)).map((c) => c.slug)).toEqual(["hidden"]);

    const category = await getPublicCategory(shopA, "totes");
    expect(category).toMatchObject({
      name: "Totes",
      ancestors: [{ name: "Bags", slug: "bags" }],
      children: [],
    });
    const parent = await getPublicCategory(shopA, "bags");
    expect(parent.description).toBe("All bags.");
    expect(parent.children.map((child) => child.slug)).toEqual(["totes"]);
    expect(parent.ancestors).toEqual([]);

    await expect(getPublicCategory(shopB, "bags")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPublicCategory(shopA, "hidden")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPublicCategory(shopA, "Not A Slug")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("lists built around one product", () => {
  it("offers other products from the same category tree, never the product itself", async () => {
    const backpack = await getPublicProduct(shopA, "city-backpack");
    const related = await listRelatedProducts(shopA, {
      id: backpack.id,
      categoryId: backpack.category!.id,
    });
    // Bags includes Totes; the draft, archived and unsellable totes stay hidden.
    expect(related.map((item) => item.name)).toEqual(["Classic Leather Tote"]);

    const tote = await getPublicProduct(shopA, "classic-leather-tote");
    expect(
      await listRelatedProducts(shopA, { id: tote.id, categoryId: tote.category!.id }),
    ).toEqual([]);
    expect(await listRelatedProducts(shopA, { id: tote.id, categoryId: null })).toEqual([]);
    // Another store asking with this store's identifiers gets nothing.
    expect(
      await listRelatedProducts(shopB, { id: backpack.id, categoryId: backpack.category!.id }),
    ).toEqual([]);
  });

  it("turns a list of URL names from a browser into cards, dropping what must not show", async () => {
    const cards = await listPublicProductsBySlug(shopA, [
      "slim-wallet",
      "secret-tote", // draft
      "old-tote", // archived
      "ghost-tote", // nothing for sale
      "other-leather-tote", // another store
      "Not A Slug",
      "'; DROP TABLE products; --",
      "classic-leather-tote",
      "slim-wallet", // repeated
    ]);
    expect(cards.map((card) => card.name)).toEqual(["Slim Wallet", "Classic Leather Tote"]);
    expect(JSON.stringify(cards)).not.toMatch(/cost/i);
    expect(await listPublicProductsBySlug(shopA, [])).toEqual([]);

    const many = Array.from({ length: 50 }, (_, index) => `no-such-${index}`);
    expect(await listPublicProductsBySlug(shopA, [...many, "slim-wallet"])).toEqual([]);
  });
});
