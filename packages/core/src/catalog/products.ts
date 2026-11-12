import type { AppTransaction } from "@ecom/db";
import { z } from "zod";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { ASSET_SELECT, toStoredImage, type StoredImage } from "../media/assets";
import {
  assertId,
  CatalogError,
  isUniqueViolation,
  nameField,
  optionalId,
  optionalText,
  parseInput,
  slugField,
} from "./errors";
import { isCurrencyCode, MAX_MONEY_AMOUNT } from "./money";
import { slugify } from "./slug";

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];
export const VARIANT_STATUSES = ["active", "inactive"] as const;
export type VariantStatusValue = (typeof VARIANT_STATUSES)[number];

export const PRODUCT_PAGE_SIZE = 25;

// --- Shapes returned to callers ---------------------------------------------

export interface Money {
  amount: number;
  currency: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  status: ProductStatusValue;
  categoryName: string | null;
  brandName: string | null;
  variantCount: number;
  /** Lowest regular price among active variants, if there is one. */
  priceFrom: Money | null;
  /** The first of the product's images, if it has any. */
  mainImage: (StoredImage & { altText: string }) | null;
  updatedAt: Date;
}

export interface ProductList {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface VariantDetail {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  color: string | null;
  size: string | null;
  priceAmount: number;
  discountPriceAmount: number | null;
  compareAtAmount: number | null;
  costAmount: number | null;
  currency: string;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  lowStockThreshold: number | null;
  position: number;
  status: VariantStatusValue;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  seoTitle: string | null;
  seoDescription: string | null;
  categoryId: string | null;
  brandId: string | null;
  audienceTags: string[];
  material: string | null;
  careInfo: string | null;
  taxClass: string | null;
  status: ProductStatusValue;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  attributes: { key: string; value: string }[];
  variants: VariantDetail[];
}

// --- Input rules -------------------------------------------------------------

const listInput = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ProductListInput = z.input<typeof listInput>;

const createInput = z.object({
  name: nameField("product name"),
  slug: slugField,
  categoryId: optionalId("category"),
  brandId: optionalId("brand"),
});
export type ProductCreateInput = z.input<typeof createInput>;

const attributeInput = z.object({
  key: z.string().trim().min(1, "A specification needs a name.").max(80),
  value: z.string().trim().min(1, "A specification needs a value.").max(500),
});

const updateInput = createInput.extend({
  shortDescription: z.string().trim().max(500, "The short description is too long.").default(""),
  description: z.string().trim().max(20_000, "The description is too long.").default(""),
  seoTitle: optionalText("The search title", 200),
  seoDescription: optionalText("The search description", 500),
  audienceTags: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .max(20, "Use 20 audience tags at most.")
    .default([])
    .transform((tags) => [...new Set(tags)]),
  material: optionalText("The material", 200),
  careInfo: optionalText("The care information", 2000),
  taxClass: optionalText("The tax class", 60),
  isFeatured: z.boolean().default(false),
  isNewArrival: z.boolean().default(false),
  isBestSeller: z.boolean().default(false),
  attributes: z
    .array(attributeInput)
    .max(50, "Use 50 specifications at most.")
    .default([])
    .refine(
      (items) => new Set(items.map((item) => item.key.toLowerCase())).size === items.length,
      "Each specification name can be used once.",
    ),
});
export type ProductUpdateInput = z.input<typeof updateInput>;

const amount = (label: string) =>
  z
    .number({ error: `Enter the ${label}.` })
    .int(`The ${label} is not a valid amount.`)
    .min(0, `The ${label} cannot be negative.`)
    .max(MAX_MONEY_AMOUNT, `The ${label} is too large.`);

const measure = (label: string) =>
  z
    .number()
    .int(`${label} must be a whole number.`)
    .min(0, `${label} cannot be negative.`)
    .max(10_000_000, `${label} is too large.`)
    .nullish()
    .transform((value) => value ?? null);

const variantInput = z
  .object({
    sku: z
      .string({ error: "Enter a SKU." })
      .trim()
      .min(1, "Enter a SKU.")
      .max(64, "The SKU is too long (64 characters at most)."),
    barcode: optionalText("The barcode", 64),
    color: optionalText("The color", 80),
    size: optionalText("The size", 80),
    /** Minor units of the store's currency. */
    priceAmount: amount("price"),
    discountPriceAmount: amount("sale price")
      .nullish()
      .transform((value) => value ?? null),
    compareAtAmount: amount("compare-at price")
      .nullish()
      .transform((value) => value ?? null),
    costAmount: amount("cost")
      .nullish()
      .transform((value) => value ?? null),
    weightGrams: measure("The weight"),
    lengthMm: measure("The length"),
    widthMm: measure("The width"),
    heightMm: measure("The height"),
    lowStockThreshold: measure("The low-stock level"),
    status: z.enum(VARIANT_STATUSES).default("active"),
  })
  .superRefine((value, ctx) => {
    if (value.discountPriceAmount !== null && value.discountPriceAmount >= value.priceAmount) {
      ctx.addIssue({
        code: "custom",
        path: ["discountPriceAmount"],
        message: "The sale price must be lower than the price.",
      });
    }
    if (value.compareAtAmount !== null && value.compareAtAmount <= value.priceAmount) {
      ctx.addIssue({
        code: "custom",
        path: ["compareAtAmount"],
        message: "The compare-at price must be higher than the price.",
      });
    }
  });
export type VariantInput = z.input<typeof variantInput>;

// --- Helpers -----------------------------------------------------------------

const SLUG_TAKEN = "Another product already uses this URL name.";
const SKU_TAKEN = "Another variant in this store already uses this SKU.";

function resolveSlug(name: string, slug: string | undefined): string {
  const value = slug || slugify(name);
  if (!value) {
    throw new CatalogError(
      "invalid",
      "Enter a URL name using lowercase letters, digits and hyphens.",
      "slug",
    );
  }
  return value;
}

/** Row-Level Security hides other tenants' rows, so "not found" covers both cases. */
async function assertReferences(
  tx: AppTransaction,
  refs: { categoryId: string | null; brandId: string | null },
) {
  if (refs.categoryId && !(await tx.category.findUnique({ where: { id: refs.categoryId } }))) {
    throw new CatalogError("unknown_reference", "Choose a category from the list.", "categoryId");
  }
  if (refs.brandId && !(await tx.brand.findUnique({ where: { id: refs.brandId } }))) {
    throw new CatalogError("unknown_reference", "Choose a brand from the list.", "brandId");
  }
}

const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  barcode: true,
  color: true,
  size: true,
  priceAmount: true,
  discountPriceAmount: true,
  compareAtAmount: true,
  costAmount: true,
  currency: true,
  weightGrams: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
  lowStockThreshold: true,
  position: true,
  status: true,
} as const;

/** The currency new variants are priced in: the store's default. */
async function storeCurrency(tx: AppTransaction, context: RequestContext): Promise<string> {
  const store = context.storeId
    ? await tx.store.findUnique({
        where: { id: context.storeId },
        select: { defaultCurrency: true },
      })
    : await tx.store.findFirst({
        select: { defaultCurrency: true },
        orderBy: { createdAt: "asc" },
      });
  const currency = store?.defaultCurrency ?? "";
  if (!isCurrencyCode(currency)) {
    throw new CatalogError("invalid", "The store has no valid currency set.");
  }
  return currency;
}

/** The currency prices are entered in for new variants. */
export async function getCatalogCurrency(db: TenantDb, context: RequestContext): Promise<string> {
  assertPermission(context, "catalog.read");
  return db.run((tx) => storeCurrency(tx, context));
}

async function activeVariantCount(tx: AppTransaction, productId: string, exceptId?: string) {
  return tx.productVariant.count({
    where: { productId, status: "active", ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
}

// --- Products ----------------------------------------------------------------

export async function listProducts(
  db: TenantDb,
  context: RequestContext,
  input: ProductListInput = {},
): Promise<ProductList> {
  assertPermission(context, "catalog.read");
  const { status, search, page } = parseInput(listInput, input);
  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { variants: { some: { sku: { contains: search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  const { rows, total } = await db.run(async (tx) => ({
    total: await tx.product.count({ where }),
    rows: await tx.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        updatedAt: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        variants: { select: { priceAmount: true, currency: true, status: true } },
        images: {
          select: { altText: true, asset: { select: ASSET_SELECT } },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PRODUCT_PAGE_SIZE,
      take: PRODUCT_PAGE_SIZE,
    }),
  }));

  return {
    total,
    page,
    pageSize: PRODUCT_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
    items: rows.map((row) => {
      const cheapest = row.variants
        .filter((variant) => variant.status === "active")
        .sort((x, y) => x.priceAmount - y.priceAmount)[0];
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        categoryName: row.category?.name ?? null,
        brandName: row.brand?.name ?? null,
        variantCount: row.variants.length,
        priceFrom: cheapest ? { amount: cheapest.priceAmount, currency: cheapest.currency } : null,
        mainImage: row.images[0]
          ? { ...toStoredImage(row.images[0].asset), altText: row.images[0].altText }
          : null,
        updatedAt: row.updatedAt,
      };
    }),
  };
}

export async function getProduct(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<ProductDetail> {
  assertPermission(context, "catalog.read");
  assertId(id, "product");
  const row = await db.run((tx) =>
    tx.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        categoryId: true,
        brandId: true,
        audienceTags: true,
        material: true,
        careInfo: true,
        taxClass: true,
        status: true,
        isFeatured: true,
        isNewArrival: true,
        isBestSeller: true,
        attributes: { select: { key: true, value: true }, orderBy: { position: "asc" } },
        variants: { select: VARIANT_SELECT, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      },
    }),
  );
  if (!row) throw new NotFoundError("product");
  return row;
}

/** Creates a draft product. Variants and details are added afterwards. */
export async function createProduct(
  db: TenantDb,
  context: RequestContext,
  input: ProductCreateInput,
): Promise<{ id: string }> {
  assertPermission(context, "catalog.write");
  const data = parseInput(createInput, input);
  const slug = resolveSlug(data.name, data.slug);
  try {
    return await db.run(async (tx) => {
      await assertReferences(tx, data);
      const created = await tx.product.create({
        data: {
          tenantId: db.tenantId,
          name: data.name,
          slug,
          categoryId: data.categoryId,
          brandId: data.brandId,
        },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "catalog.product_created",
        { type: "product", id: created.id },
        undefined,
        {
          name: data.name,
          slug,
        },
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("slug_taken", SLUG_TAKEN, "slug");
    throw error;
  }
}

export async function updateProduct(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: ProductUpdateInput,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "product");
  const { attributes, ...data } = parseInput(updateInput, input);
  const slug = resolveSlug(data.name, data.slug);
  try {
    await db.run(async (tx) => {
      const before = await tx.product.findUnique({
        where: { id },
        select: { name: true, slug: true, categoryId: true, brandId: true },
      });
      if (!before) throw new NotFoundError("product");
      await assertReferences(tx, data);
      await tx.product.update({ where: { id }, data: { ...data, slug } });

      await tx.productAttribute.deleteMany({ where: { productId: id } });
      if (attributes.length > 0) {
        await tx.productAttribute.createMany({
          data: attributes.map((attribute, position) => ({
            tenantId: db.tenantId,
            productId: id,
            key: attribute.key,
            value: attribute.value,
            position,
          })),
        });
      }
      await audit(tx, context, "catalog.product_updated", { type: "product", id }, before, {
        name: data.name,
        slug,
        categoryId: data.categoryId,
        brandId: data.brandId,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("slug_taken", SLUG_TAKEN, "slug");
    throw error;
  }
}

/**
 * Publishes, unpublishes or archives a product. A product can only be made
 * active when it has something to sell: at least one active variant.
 */
export async function setProductStatus(
  db: TenantDb,
  context: RequestContext,
  id: string,
  status: ProductStatusValue,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "product");
  const next = parseInput(z.enum(PRODUCT_STATUSES, { error: "Unknown status." }), status);
  await db.run(async (tx) => {
    const before = await tx.product.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new NotFoundError("product");
    if (before.status === next) return;
    if (next === "active" && (await activeVariantCount(tx, id)) === 0) {
      throw new CatalogError(
        "needs_active_variant",
        "Add at least one active variant with a price before publishing.",
      );
    }
    await tx.product.update({ where: { id }, data: { status: next } });
    await audit(
      tx,
      context,
      "catalog.product_status_changed",
      { type: "product", id },
      { status: before.status },
      { status: next },
    );
  });
}

// --- Variants ----------------------------------------------------------------

export async function getVariant(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<VariantDetail & { productName: string }> {
  assertPermission(context, "catalog.read");
  assertId(id, "variant");
  const row = await db.run((tx) =>
    tx.productVariant.findUnique({
      where: { id },
      select: { ...VARIANT_SELECT, product: { select: { name: true } } },
    }),
  );
  if (!row) throw new NotFoundError("variant");
  const { product, ...variant } = row;
  return { ...variant, productName: product.name };
}

export async function addVariant(
  db: TenantDb,
  context: RequestContext,
  productId: string,
  input: VariantInput,
): Promise<{ id: string }> {
  assertPermission(context, "catalog.write");
  assertId(productId, "product");
  const data = parseInput(variantInput, input);
  try {
    return await db.run(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { _count: { select: { variants: true } } },
      });
      if (!product) throw new NotFoundError("product");
      const currency = await storeCurrency(tx, context);
      const created = await tx.productVariant.create({
        data: {
          ...data,
          tenantId: db.tenantId,
          productId,
          currency,
          position: product._count.variants,
        },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "catalog.variant_created",
        { type: "variant", id: created.id },
        undefined,
        {
          productId,
          sku: data.sku,
          priceAmount: data.priceAmount,
          currency,
        },
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("sku_taken", SKU_TAKEN, "sku");
    throw error;
  }
}

export async function updateVariant(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: VariantInput,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "variant");
  const data = parseInput(variantInput, input);
  try {
    await db.run(async (tx) => {
      const before = await tx.productVariant.findUnique({
        where: { id },
        select: {
          sku: true,
          priceAmount: true,
          discountPriceAmount: true,
          status: true,
          productId: true,
          product: { select: { status: true } },
        },
      });
      if (!before) throw new NotFoundError("variant");
      if (
        data.status === "inactive" &&
        before.product.status === "active" &&
        (await activeVariantCount(tx, before.productId, id)) === 0
      ) {
        throw new CatalogError(
          "last_active_variant",
          "A published product needs one active variant. Unpublish the product first.",
          "status",
        );
      }
      await tx.productVariant.update({ where: { id }, data });
      await audit(
        tx,
        context,
        "catalog.variant_updated",
        { type: "variant", id },
        {
          sku: before.sku,
          priceAmount: before.priceAmount,
          discountPriceAmount: before.discountPriceAmount,
          status: before.status,
        },
        {
          sku: data.sku,
          priceAmount: data.priceAmount,
          discountPriceAmount: data.discountPriceAmount,
          status: data.status,
        },
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("sku_taken", SKU_TAKEN, "sku");
    throw error;
  }
}

export async function deleteVariant(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<{ productId: string }> {
  assertPermission(context, "catalog.write");
  assertId(id, "variant");
  return db.run(async (tx) => {
    const before = await tx.productVariant.findUnique({
      where: { id },
      select: { sku: true, productId: true, product: { select: { status: true } } },
    });
    if (!before) throw new NotFoundError("variant");
    if (
      before.product.status === "active" &&
      (await activeVariantCount(tx, before.productId, id)) === 0
    ) {
      throw new CatalogError(
        "last_active_variant",
        "A published product needs one active variant. Unpublish the product first.",
      );
    }
    await tx.productVariant.delete({ where: { id } });
    await audit(
      tx,
      context,
      "catalog.variant_deleted",
      { type: "variant", id },
      {
        productId: before.productId,
        sku: before.sku,
      },
    );
    return { productId: before.productId };
  });
}
