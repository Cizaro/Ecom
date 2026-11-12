import type { TenantDb } from "../access/tenant-db";

// Demonstration catalog for local development: the five launch categories and
// two sample products, so the admin is not empty on a new computer. Written
// only if the tenant has no categories yet, so it never overwrites real work.

const CATEGORIES = [
  { name: "Women's Bags", slug: "womens-bags" },
  { name: "Men's Wallets", slug: "mens-wallets" },
  { name: "Watches", slug: "watches" },
  { name: "Jewelry", slug: "jewelry" },
  { name: "Accessories", slug: "accessories" },
] as const;

export async function seedDemoCatalog(
  db: TenantDb,
): Promise<{ created: boolean; categories: number; products: number }> {
  return db.run(async (tx) => {
    if ((await tx.category.count()) > 0) return { created: false, categories: 0, products: 0 };

    const store = await tx.store.findFirst({
      select: { defaultCurrency: true },
      orderBy: { createdAt: "asc" },
    });
    const currency = store?.defaultCurrency ?? "USD";
    const tenantId = db.tenantId;

    const ids: Record<string, string> = {};
    for (const [position, category] of CATEGORIES.entries()) {
      const row = await tx.category.create({
        data: { tenantId, ...category, position },
        select: { id: true },
      });
      ids[category.slug] = row.id;
    }

    const tote = await tx.product.create({
      data: {
        tenantId,
        name: "Sample Leather Tote",
        slug: "sample-leather-tote",
        shortDescription: "Sample product for trying out the admin.",
        categoryId: ids["womens-bags"],
        audienceTags: ["women"],
        material: "Leather",
        status: "active",
      },
      select: { id: true },
    });
    await tx.productVariant.createMany({
      data: [
        { sku: "SAMPLE-TOTE-BLK", color: "Black", position: 0 },
        { sku: "SAMPLE-TOTE-TAN", color: "Tan", position: 1 },
      ].map((variant) => ({
        ...variant,
        tenantId,
        productId: tote.id,
        priceAmount: 8900,
        currency,
      })),
    });

    const wallet = await tx.product.create({
      data: {
        tenantId,
        name: "Sample Bifold Wallet",
        slug: "sample-bifold-wallet",
        shortDescription: "Sample draft product.",
        categoryId: ids["mens-wallets"],
        audienceTags: ["men"],
        status: "draft",
      },
      select: { id: true },
    });
    await tx.productVariant.create({
      data: {
        tenantId,
        productId: wallet.id,
        sku: "SAMPLE-WALLET-BRN",
        color: "Brown",
        priceAmount: 3500,
        currency,
      },
    });

    return { created: true, categories: CATEGORIES.length, products: 2 };
  });
}
