import { z } from "zod";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import {
  assertId,
  CatalogError,
  isUniqueViolation,
  nameField,
  parseInput,
  slugField,
} from "./errors";
import { slugify } from "./slug";

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

const brandInput = z.object({ name: nameField("brand name"), slug: slugField });

export type BrandInput = z.input<typeof brandInput>;

const SLUG_TAKEN = "Another brand already uses this URL name.";

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

export async function listBrands(db: TenantDb, context: RequestContext): Promise<BrandSummary[]> {
  assertPermission(context, "catalog.read");
  const rows = await db.run((tx) =>
    tx.brand.findMany({
      select: { id: true, name: true, slug: true, _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    productCount: row._count.products,
  }));
}

export async function getBrand(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<{ id: string; name: string; slug: string }> {
  assertPermission(context, "catalog.read");
  assertId(id, "brand");
  const row = await db.run((tx) =>
    tx.brand.findUnique({ where: { id }, select: { id: true, name: true, slug: true } }),
  );
  if (!row) throw new NotFoundError("brand");
  return row;
}

export async function createBrand(
  db: TenantDb,
  context: RequestContext,
  input: BrandInput,
): Promise<{ id: string }> {
  assertPermission(context, "catalog.write");
  const data = parseInput(brandInput, input);
  const slug = resolveSlug(data.name, data.slug);
  try {
    return await db.run(async (tx) => {
      const created = await tx.brand.create({
        data: { name: data.name, slug, tenantId: db.tenantId },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "catalog.brand_created",
        { type: "brand", id: created.id },
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

export async function updateBrand(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: BrandInput,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "brand");
  const data = parseInput(brandInput, input);
  const slug = resolveSlug(data.name, data.slug);
  try {
    await db.run(async (tx) => {
      const before = await tx.brand.findUnique({
        where: { id },
        select: { name: true, slug: true },
      });
      if (!before) throw new NotFoundError("brand");
      await tx.brand.update({ where: { id }, data: { name: data.name, slug } });
      await audit(tx, context, "catalog.brand_updated", { type: "brand", id }, before, {
        name: data.name,
        slug,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("slug_taken", SLUG_TAKEN, "slug");
    throw error;
  }
}

/** Deletes a brand. Its products stay and lose their brand. */
export async function deleteBrand(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "brand");
  await db.run(async (tx) => {
    const before = await tx.brand.findUnique({
      where: { id },
      select: { name: true, slug: true, _count: { select: { products: true } } },
    });
    if (!before) throw new NotFoundError("brand");
    await tx.brand.delete({ where: { id } });
    await audit(
      tx,
      context,
      "catalog.brand_deleted",
      { type: "brand", id },
      {
        name: before.name,
        slug: before.slug,
        products: before._count.products,
      },
    );
  });
}
