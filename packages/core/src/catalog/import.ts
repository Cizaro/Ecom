import { randomBytes } from "node:crypto";
import type { Prisma } from "@ecom/db";
import {
  assertPermission,
  hasPermission,
  NotFoundError,
  type RequestContext,
} from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { receiveOpeningStockIn } from "../inventory/stock";
import type { MediaDeps } from "../media/assets";
import { fetchImageFromUrl, ImageFetchError } from "../media/fetch-image";
import { CatalogError } from "./errors";
import { attachImportedImage, MAX_PRODUCT_IMAGES } from "./images";
import {
  buildImportTemplate,
  readImportFile,
  type ImportColumn,
  type SheetRow,
} from "./import-file";
import { MAX_MONEY_AMOUNT, parseMoney } from "./money";
import { slugify } from "./slug";

// Bulk product import from a spreadsheet. Two steps, so nothing is saved by
// accident:
//
// 1. Check: the file is read and every row checked against the store
//    (categories and brands must exist, SKUs must be new, prices valid).
//    The result, with any problems, is kept as a "checked" import.
// 2. Import: only a checked import with no problems can run. All products
//    are created in one transaction (all or nothing), as drafts unless staff
//    chose to publish. Picture links are downloaded afterwards, safely, by
//    the request and then the worker; a broken link is reported and never
//    stops the products being created.
//
// Needs catalog.write; opening stock also needs inventory.adjust.

export const MAX_PICTURES_PER_PRODUCT = 8;
const IMAGE_ATTEMPTS = 3;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export interface ImportProblem {
  row: number;
  column: string;
  message: string;
}

interface ImportVariant {
  row: number;
  sku: string;
  color: string | null;
  size: string | null;
  priceAmount: number;
  discountPriceAmount: number | null;
  stock: number | null;
  lowStock: number | null;
}

interface ImportProduct {
  row: number;
  name: string;
  slug: string;
  categoryId: string | null;
  brandId: string | null;
  description: string;
  pictures: string[];
  variants: ImportVariant[];
}

const LABEL: Record<ImportColumn, string> = {
  name: "Product name",
  category: "Category",
  brand: "Brand",
  description: "Description",
  color: "Colour",
  size: "Size",
  sku: "SKU",
  price: "Price",
  salePrice: "Sale price",
  stock: "Stock",
  lowStock: "Low-stock level",
  pictures: "Picture links",
};

const fold = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

function wholeNumber(value: string | undefined): number | null | typeof Number.NaN {
  if (value === undefined || value === "") return null;
  const raw = value.replace(/\.0+$/, "");
  return /^\d{1,7}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** Splits picture links on commas, semicolons, spaces or new lines. */
export function splitPictureLinks(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function validLink(link: string): boolean {
  try {
    const url = new URL(link);
    return (url.protocol === "https:" || url.protocol === "http:") && link.length <= 2000;
  } catch {
    return false;
  }
}

export interface ImportSummary {
  id: string;
  fileName: string;
  status: "checked" | "imported" | "discarded";
  productCount: number;
  variantCount: number;
  imageCount: number;
  problems: ImportProblem[];
  publish: boolean;
  createdAt: Date;
  importedAt: Date | null;
  /** Once imported: picture downloads so far. */
  images: { pending: number; done: number; failed: number };
  failedImages: { url: string; error: string | null; productId: string }[];
  /** Once imported: the products created, first ones. */
  products: { id: string; name: string }[];
}

/** Step 1: reads and checks a file, and keeps the result. */
export async function checkProductImport(
  db: TenantDb,
  context: RequestContext,
  input: { fileName: string; bytes: Uint8Array },
): Promise<{ id: string }> {
  assertPermission(context, "catalog.write");
  const fileName = (input.fileName || "import").replace(/[\r\n]/g, " ").slice(0, 200);
  let rows: SheetRow[];
  try {
    rows = await readImportFile(fileName, input.bytes);
  } catch (error) {
    if (error instanceof Error && error.name === "ImportFileError") {
      throw new ImportError(error.message);
    }
    throw error;
  }
  const canStock = hasPermission(context, "inventory.adjust");

  return db.run(async (tx) => {
    const [store, categories, brands] = await Promise.all([
      tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
      tx.category.findMany({ select: { id: true, name: true } }),
      tx.brand.findMany({ select: { id: true, name: true } }),
    ]);
    const currency = store?.defaultCurrency ?? "USD";
    const categoryByName = new Map(categories.map((c) => [fold(c.name), c.id]));
    const brandByName = new Map(brands.map((b) => [fold(b.name), b.id]));
    const skus = rows.map((row) => row.values.sku?.trim()).filter((sku): sku is string => !!sku);
    const taken = new Set(
      (
        await tx.productVariant.findMany({
          where: { sku: { in: skus } },
          select: { sku: true },
        })
      ).map((v) => v.sku),
    );

    const problems: ImportProblem[] = [];
    const problem = (row: number, column: ImportColumn, message: string) =>
      problems.push({ row, column: LABEL[column], message });
    const products = new Map<string, ImportProduct>();
    const seenSkus = new Map<string, number>();

    for (const { rowNumber: row, values } of rows) {
      const name = (values.name ?? "").trim().replace(/\s+/g, " ");
      if (!name) {
        problem(row, "name", "Enter the product name.");
        continue;
      }
      if (name.length > 200) problem(row, "name", "Shorten the name (200 characters at most).");

      let product = products.get(fold(name));
      if (!product) {
        const category = values.category ? categoryByName.get(fold(values.category)) : null;
        if (values.category && !category) {
          problem(
            row,
            "category",
            `There is no category called "${values.category.slice(0, 80)}". Add it under Categories first, then pick it from the dropdown.`,
          );
        }
        const brand = values.brand ? brandByName.get(fold(values.brand)) : null;
        if (values.brand && !brand) {
          problem(
            row,
            "brand",
            `There is no brand called "${values.brand.slice(0, 80)}". Add it under Brands first, then pick it from the dropdown.`,
          );
        }
        const description = (values.description ?? "").trim();
        if (description.length > 20_000)
          problem(row, "description", "The description is too long.");
        const pictures = splitPictureLinks(values.pictures);
        if (pictures.length > MAX_PICTURES_PER_PRODUCT) {
          problem(
            row,
            "pictures",
            `Use up to ${MAX_PICTURES_PER_PRODUCT} picture links per product.`,
          );
        }
        const bad = pictures.find((link) => !validLink(link));
        if (bad) {
          problem(row, "pictures", `"${bad.slice(0, 80)}" is not a web address (https://...).`);
        }
        product = {
          row,
          name,
          slug: "",
          categoryId: category ?? null,
          brandId: brand ?? null,
          description,
          pictures: pictures.slice(0, MAX_PICTURES_PER_PRODUCT),
          variants: [],
        };
        products.set(fold(name), product);
      } else {
        // Later rows of the same product: product details come from its first row.
        for (const column of ["category", "brand", "description", "pictures"] as const) {
          const first = rows.find((r) => r.rowNumber === product!.row)?.values[column] ?? "";
          if (values[column] && fold(values[column]!) !== fold(first)) {
            problem(
              row,
              column,
              `Differs from row ${product.row}, the first row for "${name}". Leave it empty or make it the same.`,
            );
          }
        }
      }

      const sku = (values.sku ?? "").trim();
      if (!sku) problem(row, "sku", "Enter the SKU.");
      else if (sku.length > 64) problem(row, "sku", "The SKU is too long (64 characters at most).");
      else if (taken.has(sku))
        problem(row, "sku", `A product in the store already uses SKU ${sku}.`);
      else if (seenSkus.has(sku)) {
        problem(
          row,
          "sku",
          `SKU ${sku} is also on row ${seenSkus.get(sku)}. Each SKU must be different.`,
        );
      }
      if (sku) seenSkus.set(sku, seenSkus.get(sku) ?? row);

      const price = values.price ? parseMoney(values.price, currency) : null;
      if (!values.price) problem(row, "price", "Enter the price.");
      else if (price === null || price > MAX_MONEY_AMOUNT) {
        problem(row, "price", `"${values.price}" is not a price. Write it like 40 or 39.99.`);
      }
      const sale = values.salePrice ? parseMoney(values.salePrice, currency) : null;
      if (values.salePrice && sale === null) {
        problem(
          row,
          "salePrice",
          `"${values.salePrice}" is not a price. Write it like 30 or 29.99.`,
        );
      } else if (sale !== null && price !== null && sale >= price) {
        problem(row, "salePrice", "The sale price must be lower than the price.");
      }
      const stock = wholeNumber(values.stock);
      if (Number.isNaN(stock))
        problem(row, "stock", "Enter the stock as a whole number, or leave it empty.");
      else if (stock !== null && stock > 0 && !canStock) {
        problem(
          row,
          "stock",
          "Your role cannot set stock. Leave Stock empty, or ask someone who manages stock.",
        );
      }
      const lowStock = wholeNumber(values.lowStock);
      if (Number.isNaN(lowStock))
        problem(row, "lowStock", "Enter the low-stock level as a whole number, or leave it empty.");

      const color = values.color?.trim().slice(0, 80) || null;
      const size = values.size?.trim().slice(0, 80) || null;
      if (product.variants.some((v) => v.color === color && v.size === size) && (color || size)) {
        problem(row, "color", `"${name}" already has a row with this colour and size.`);
      }
      product.variants.push({
        row,
        sku,
        color,
        size,
        priceAmount: price ?? 0,
        discountPriceAmount: sale,
        stock: Number.isNaN(stock) ? null : (stock as number | null),
        lowStock: Number.isNaN(lowStock) ? null : (lowStock as number | null),
      });
    }

    // URL names: from the product name, made unique in the store and the file.
    const existingSlugs = new Set(
      (await tx.product.findMany({ select: { slug: true } })).map((p) => p.slug),
    );
    for (const product of products.values()) {
      const base = slugify(product.name) || `product-${randomBytes(3).toString("hex")}`;
      let slug = base;
      for (let n = 2; existingSlugs.has(slug); n += 1) slug = `${base}-${n}`.slice(0, 120);
      existingSlugs.add(slug);
      product.slug = slug;
    }

    const list = [...products.values()];
    const created = await tx.productImport.create({
      data: {
        tenantId: db.tenantId,
        createdByUserId: context.userId,
        fileName,
        data: { products: list } as unknown as Prisma.InputJsonObject,
        problems: problems.slice(0, 500) as unknown as Prisma.InputJsonArray,
        productCount: list.length,
        variantCount: list.reduce((sum, p) => sum + p.variants.length, 0),
        imageCount: list.reduce((sum, p) => sum + p.pictures.length, 0),
      },
      select: { id: true },
    });
    await audit(
      tx,
      context,
      "catalog.import_checked",
      { type: "product_import", id: created.id },
      undefined,
      {
        fileName,
        rows: rows.length,
        problems: problems.length,
      },
    );
    return created;
  });
}

/** Step 2: creates the products of a checked import with no problems. */
export async function runProductImport(
  db: TenantDb,
  context: RequestContext,
  importId: string,
  options: { publish: boolean },
): Promise<{ created: number }> {
  assertPermission(context, "catalog.write");
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new NotFoundError("import");
  try {
    return await db.run(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM product_imports WHERE id = ${importId}::uuid FOR UPDATE`;
        const found = await tx.productImport.findUnique({
          where: { id: importId },
          select: { status: true, data: true, problems: true },
        });
        if (!found) throw new NotFoundError("import");
        if (found.status !== "checked")
          throw new ImportError("This file has already been imported.");
        if ((found.problems as unknown[]).length > 0) {
          throw new ImportError(
            "Fix the problems in the file and check it again before importing.",
          );
        }
        const { products } = found.data as unknown as { products: ImportProduct[] };
        if (products.some((p) => p.variants.some((v) => (v.stock ?? 0) > 0))) {
          assertPermission(context, "inventory.adjust");
        }
        const store = await tx.store.findFirst({
          select: { defaultCurrency: true },
          orderBy: { createdAt: "asc" },
        });
        const currency = store?.defaultCurrency ?? "USD";
        for (const product of products) {
          const createdProduct = await tx.product.create({
            data: {
              tenantId: db.tenantId,
              name: product.name,
              slug: product.slug,
              categoryId: product.categoryId,
              brandId: product.brandId,
              description: product.description,
              status: options.publish ? "active" : "draft",
            },
            select: { id: true },
          });
          for (const [position, variant] of product.variants.entries()) {
            const createdVariant = await tx.productVariant.create({
              data: {
                tenantId: db.tenantId,
                productId: createdProduct.id,
                sku: variant.sku,
                color: variant.color,
                size: variant.size,
                priceAmount: variant.priceAmount,
                discountPriceAmount: variant.discountPriceAmount,
                currency,
                position,
                trackInventory: variant.stock !== null,
                lowStockThreshold: variant.lowStock,
              },
              select: { id: true },
            });
            if (variant.stock) {
              await receiveOpeningStockIn(tx, db.tenantId, {
                variantId: createdVariant.id,
                quantity: variant.stock,
                actorUserId: context.userId,
                note: "Opening stock from import",
              });
            }
          }
          if (product.pictures.length > 0) {
            await tx.productImportImage.createMany({
              data: product.pictures.map((url, position) => ({
                tenantId: db.tenantId,
                importId,
                productId: createdProduct.id,
                url,
                position,
              })),
            });
          }
        }
        await tx.productImport.update({
          where: { id: importId },
          data: { status: "imported", publish: options.publish, importedAt: new Date() },
        });
        await audit(
          tx,
          context,
          "catalog.import_run",
          { type: "product_import", id: importId },
          undefined,
          {
            products: products.length,
            publish: options.publish,
          },
        );
        return { created: products.length };
      },
      { timeoutMs: 120_000 },
    );
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new ImportError(
        "A SKU or product in this file was added to the store after the check. Check the file again.",
      );
    }
    throw error;
  }
}

/** Throws away a checked import (staff fix the file and upload it again). */
export async function discardProductImport(
  db: TenantDb,
  context: RequestContext,
  importId: string,
): Promise<void> {
  assertPermission(context, "catalog.write");
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new NotFoundError("import");
  await db.run(async (tx) => {
    const updated = await tx.productImport.updateMany({
      where: { id: importId, status: "checked" },
      data: { status: "discarded" },
    });
    if (updated.count === 0) throw new NotFoundError("import");
  });
}

export async function getProductImport(
  db: TenantDb,
  context: RequestContext,
  importId: string,
): Promise<ImportSummary> {
  assertPermission(context, "catalog.write");
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new NotFoundError("import");
  return db.run(async (tx) => {
    const row = await tx.productImport.findUnique({ where: { id: importId } });
    if (!row) throw new NotFoundError("import");
    const counts = await tx.productImportImage.groupBy({
      by: ["status"],
      where: { importId },
      _count: { _all: true },
    });
    const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
    const failedImages = await tx.productImportImage.findMany({
      where: { importId, status: "failed" },
      select: { url: true, error: true, productId: true },
      take: 50,
    });
    const { products: planned } = row.data as unknown as { products: ImportProduct[] };
    const products =
      row.status === "imported"
        ? await tx.product.findMany({
            where: { slug: { in: planned.slice(0, 20).map((p) => p.slug) } },
            select: { id: true, name: true },
          })
        : [];
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status as ImportSummary["status"],
      productCount: row.productCount,
      variantCount: row.variantCount,
      imageCount: row.imageCount,
      problems: row.problems as unknown as ImportProblem[],
      publish: row.publish,
      createdAt: row.createdAt,
      importedAt: row.importedAt,
      images: { pending: count("pending"), done: count("done"), failed: count("failed") },
      failedImages,
      products,
    };
  });
}

export async function listProductImports(
  db: TenantDb,
  context: RequestContext,
): Promise<
  Pick<ImportSummary, "id" | "fileName" | "status" | "productCount" | "createdAt" | "importedAt">[]
> {
  assertPermission(context, "catalog.write");
  return db.run(async (tx) =>
    (
      await tx.productImport.findMany({
        select: {
          id: true,
          fileName: true,
          status: true,
          productCount: true,
          createdAt: true,
          importedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    ).map((row) => ({ ...row, status: row.status as ImportSummary["status"] })),
  );
}

/**
 * Downloads waiting picture links for this store and adds them to their
 * products. Run straight after an import (with a small limit) and by the
 * worker. Each link is claimed first, so two runs never fetch the same one.
 */
export async function processImportImages(
  db: TenantDb,
  deps: MediaDeps,
  options: { limit?: number; allowPrivateHosts?: boolean; deadline?: number } = {},
): Promise<{ done: number; failed: number }> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const claimed = await db.run(
    (tx) => tx.$queryRaw<
      {
        id: string;
        url: string;
        product_id: string;
        attempts: number;
        import_id: string;
        position: number;
        created_at: Date;
      }[]
    >`
      UPDATE product_import_images
         SET locked_until = now() + interval '5 minutes', attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM product_import_images
          WHERE status = 'pending' AND available_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY created_at, position
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, url, product_id, attempts, import_id, position, created_at`,
  );
  // RETURNING does not keep the subquery's order: add each product's pictures in
  // the order they were listed.
  claimed.sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.position - b.position,
  );
  let done = 0;
  let failed = 0;
  for (const image of claimed) {
    if (options.deadline && Date.now() > options.deadline) {
      // Out of time: give it back for the worker.
      await db.run((tx) =>
        tx.productImportImage.update({
          where: { id: image.id },
          data: { lockedUntil: null, attempts: { decrement: 1 } },
        }),
      );
      continue;
    }
    try {
      const bytes = await fetchImageFromUrl(image.url, {
        allowPrivateHosts: options.allowPrivateHosts,
      });
      const owner = await db.run((tx) =>
        tx.productImport.findUnique({
          where: { id: image.import_id },
          select: { createdByUserId: true },
        }),
      );
      await attachImportedImage(db, deps, {
        productId: image.product_id,
        bytes,
        userId: owner?.createdByUserId ?? null,
      });
      await db.run((tx) =>
        tx.productImportImage.update({
          where: { id: image.id },
          data: { status: "done", lockedUntil: null, error: null },
        }),
      );
      done += 1;
    } catch (error) {
      const message =
        error instanceof ImageFetchError || error instanceof CatalogError
          ? error.message
          : "The picture could not be added.";
      // Broken links and bad files do not get better by retrying; network trouble might.
      const final =
        image.attempts >= IMAGE_ATTEMPTS ||
        error instanceof CatalogError ||
        (error instanceof ImageFetchError &&
          !/took too long|could not be downloaded|status 5/.test(message));
      await db.run((tx) =>
        tx.productImportImage.update({
          where: { id: image.id },
          data: {
            status: final ? "failed" : "pending",
            error: message.slice(0, 500),
            lockedUntil: null,
            availableAt: new Date(Date.now() + 60_000 * image.attempts),
          },
        }),
      );
      if (final) failed += 1;
    }
  }
  return { done, failed };
}

/** Only so the constant is visible to callers that show limits. */
export const PRODUCT_IMAGE_LIMIT = MAX_PRODUCT_IMAGES;

/** The import template for this store, with its categories and brands as dropdowns. */
export async function importTemplateFor(
  db: TenantDb,
  context: RequestContext,
): Promise<{ bytes: Uint8Array; filename: string }> {
  assertPermission(context, "catalog.write");
  const { store, categories, brands } = await db.run(async (tx) => ({
    store: await tx.store.findFirst({
      select: { name: true, defaultCurrency: true },
      orderBy: { createdAt: "asc" },
    }),
    categories: await tx.category.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    brands: await tx.brand.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  }));
  const bytes = await buildImportTemplate({
    storeName: store?.name ?? context.tenantName,
    currency: store?.defaultCurrency ?? "USD",
    categories: categories.map((c) => c.name),
    brands: brands.map((b) => b.name),
  });
  return { bytes, filename: "product-import-template.xlsx" };
}
