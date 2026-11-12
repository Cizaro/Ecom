import type { AppTransaction } from "@ecom/db";
import { z } from "zod";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
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
import { slugify } from "./slug";

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  position: number;
  /** 0 for a top-level category. */
  depth: number;
  productCount: number;
  childCount: number;
}

export interface CategoryDetail {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string;
  position: number;
  seoTitle: string | null;
  seoDescription: string | null;
}

const categoryInput = z.object({
  name: nameField("category name"),
  slug: slugField,
  parentId: optionalId("parent category"),
  description: z.string().trim().max(5000, "The description is too long.").default(""),
  position: z.coerce
    .number({ error: "The position must be a whole number." })
    .int("The position must be a whole number.")
    .min(0, "The position cannot be negative.")
    .max(100_000, "The position is too large.")
    .default(0),
  seoTitle: optionalText("The search title", 200),
  seoDescription: optionalText("The search description", 500),
});

export type CategoryInput = z.input<typeof categoryInput>;

const SLUG_TAKEN = "Another category already uses this URL name.";
const NEEDS_SLUG = "Enter a URL name using lowercase letters, digits and hyphens.";

function resolveSlug(name: string, slug: string | undefined): string {
  const value = slug || slugify(name);
  if (!value) throw new CatalogError("invalid", NEEDS_SLUG, "slug");
  return value;
}

/**
 * All categories of the tenant as a flattened tree: parents before their
 * children, siblings by position then name.
 */
export async function listCategories(
  db: TenantDb,
  context: RequestContext,
): Promise<CategoryNode[]> {
  assertPermission(context, "catalog.read");
  const rows = await db.run((tx) =>
    tx.category.findMany({
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        position: true,
        _count: { select: { products: true, children: true } },
      },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
  );

  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(row);
    byParent.set(row.parentId, siblings);
  }
  const ordered: CategoryNode[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const row of byParent.get(parentId) ?? []) {
      ordered.push({
        id: row.id,
        parentId: row.parentId,
        name: row.name,
        slug: row.slug,
        position: row.position,
        depth,
        productCount: row._count.products,
        childCount: row._count.children,
      });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}

export async function getCategory(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<CategoryDetail> {
  assertPermission(context, "catalog.read");
  assertId(id, "category");
  const row = await db.run((tx) =>
    tx.category.findUnique({
      where: { id },
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        description: true,
        position: true,
        seoTitle: true,
        seoDescription: true,
      },
    }),
  );
  if (!row) throw new NotFoundError("category");
  return row;
}

async function assertParent(tx: AppTransaction, parentId: string | null, selfId?: string) {
  if (parentId === null) return;
  if (parentId === selfId) {
    throw new CatalogError("parent_cycle", "A category cannot be its own parent.", "parentId");
  }
  // Walk up from the proposed parent; meeting this category means a loop.
  let cursor: string | null = parentId;
  for (let depth = 0; cursor !== null; depth += 1) {
    if (depth > 50) throw new CatalogError("parent_cycle", "The category tree is too deep.");
    const parent: { parentId: string | null } | null = await tx.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!parent) {
      throw new CatalogError(
        "unknown_reference",
        "Choose a parent category from the list.",
        "parentId",
      );
    }
    if (parent.parentId === selfId && selfId !== undefined) {
      throw new CatalogError(
        "parent_cycle",
        "A category cannot be moved under one of its own sub-categories.",
        "parentId",
      );
    }
    cursor = parent.parentId;
  }
}

export async function createCategory(
  db: TenantDb,
  context: RequestContext,
  input: CategoryInput,
): Promise<{ id: string }> {
  assertPermission(context, "catalog.write");
  const data = parseInput(categoryInput, input);
  const slug = resolveSlug(data.name, data.slug);
  try {
    return await db.run(async (tx) => {
      await assertParent(tx, data.parentId);
      const created = await tx.category.create({
        data: { ...data, slug, tenantId: db.tenantId },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "catalog.category_created",
        { type: "category", id: created.id },
        undefined,
        {
          name: data.name,
          slug,
          parentId: data.parentId,
        },
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("slug_taken", SLUG_TAKEN, "slug");
    throw error;
  }
}

export async function updateCategory(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: CategoryInput,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "category");
  const data = parseInput(categoryInput, input);
  const slug = resolveSlug(data.name, data.slug);
  try {
    await db.run(async (tx) => {
      const before = await tx.category.findUnique({
        where: { id },
        select: { name: true, slug: true, parentId: true },
      });
      if (!before) throw new NotFoundError("category");
      await assertParent(tx, data.parentId, id);
      await tx.category.update({ where: { id }, data: { ...data, slug } });
      await audit(tx, context, "catalog.category_updated", { type: "category", id }, before, {
        name: data.name,
        slug,
        parentId: data.parentId,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CatalogError("slug_taken", SLUG_TAKEN, "slug");
    throw error;
  }
}

/**
 * Deletes a category. Its products stay and become uncategorised. Refused
 * while the category still has sub-categories.
 */
export async function deleteCategory(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, "category");
  await db.run(async (tx) => {
    const before = await tx.category.findUnique({
      where: { id },
      select: { name: true, slug: true, _count: { select: { children: true, products: true } } },
    });
    if (!before) throw new NotFoundError("category");
    if (before._count.children > 0) {
      throw new CatalogError(
        "has_children",
        "Move or delete this category's sub-categories first.",
      );
    }
    await tx.category.delete({ where: { id } });
    await audit(
      tx,
      context,
      "catalog.category_deleted",
      { type: "category", id },
      {
        name: before.name,
        slug: before.slug,
        products: before._count.products,
      },
    );
  });
}
