import type { Locale } from "@ecom/i18n";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { assertId, CatalogError } from "./errors";
import type { PublicCategory, PublicProduct } from "./public";

// Product and category wording in a second language (Arabic). The wording on
// the product itself is the store's default language; a translation is
// optional, and anything left empty shows the default wording. Shop pages
// load their records as usual and then pass them through localize...() here,
// so no listing query has to know about languages.

/** Languages a translation can be saved for (English is the product's own wording). */
export const TRANSLATED_LOCALES = ["ar"] as const satisfies readonly Locale[];
type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];

const isTranslated = (locale: Locale): locale is TranslatedLocale =>
  (TRANSLATED_LOCALES as readonly string[]).includes(locale);

export interface ProductText {
  name: string;
  shortDescription: string;
  description: string;
}

export interface CategoryText {
  name: string;
  description: string;
}

/** Only the parts that are written: empty parts fall back to the default wording. */
function written<T extends object>(text: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(text).filter(([, value]) => typeof value === "string" && value.trim() !== ""),
  ) as Partial<T>;
}

// --- Shop ---------------------------------------------------------------------

async function productTexts(
  db: TenantDb,
  locale: Locale,
  productIds: readonly string[],
): Promise<Map<string, Partial<ProductText>>> {
  if (!isTranslated(locale) || productIds.length === 0) return new Map();
  const rows = await db.run((tx) =>
    tx.productTranslation.findMany({
      where: { locale, productId: { in: [...new Set(productIds)] } },
      select: { productId: true, name: true, shortDescription: true, description: true },
    }),
  );
  return new Map(rows.map(({ productId, ...text }) => [productId, written(text)]));
}

async function categoryTexts(
  db: TenantDb,
  locale: Locale,
  where: { ids?: readonly string[]; slugs?: readonly string[] },
): Promise<{
  byId: Map<string, Partial<CategoryText>>;
  bySlug: Map<string, Partial<CategoryText>>;
}> {
  const byId = new Map<string, Partial<CategoryText>>();
  const bySlug = new Map<string, Partial<CategoryText>>();
  const ids = [...new Set(where.ids ?? [])];
  const slugs = [...new Set(where.slugs ?? [])];
  if (!isTranslated(locale) || ids.length + slugs.length === 0) return { byId, bySlug };
  const rows = await db.run((tx) =>
    tx.categoryTranslation.findMany({
      where: {
        locale,
        OR: [{ categoryId: { in: ids } }, { category: { slug: { in: slugs } } }],
      },
      select: { name: true, description: true, category: { select: { id: true, slug: true } } },
    }),
  );
  for (const row of rows) {
    const text = written({ name: row.name, description: row.description });
    byId.set(row.category.id, text);
    bySlug.set(row.category.slug, text);
  }
  return { byId, bySlug };
}

/** Product cards, cart lines, anything with a product id and name: names in the shopper's language. */
export async function localizeProducts<T extends { name: string }>(
  db: TenantDb,
  locale: Locale,
  items: readonly T[],
  idOf: (item: T) => string,
): Promise<T[]> {
  const texts = await productTexts(db, locale, items.map(idOf));
  if (texts.size === 0) return [...items];
  return items.map((item) => {
    const name = texts.get(idOf(item))?.name;
    return name ? { ...item, name } : item;
  });
}

/** Product names in the shopper's language by URL name, for lists that carry no product id (the cart). */
export async function productNamesBySlug(
  db: TenantDb,
  locale: Locale,
  slugs: readonly string[],
): Promise<Map<string, string>> {
  if (!isTranslated(locale) || slugs.length === 0) return new Map();
  const rows = await db.run((tx) =>
    tx.productTranslation.findMany({
      where: { locale, name: { not: "" }, product: { slug: { in: [...new Set(slugs)] } } },
      select: { name: true, product: { select: { slug: true } } },
    }),
  );
  return new Map(rows.map((row) => [row.product.slug, row.name]));
}

/** The product page, in the shopper's language where the store has written it. */
export async function localizeProduct(
  db: TenantDb,
  locale: Locale,
  product: PublicProduct,
): Promise<PublicProduct> {
  if (!isTranslated(locale)) return product;
  const [texts, categories] = await Promise.all([
    productTexts(db, locale, [product.id]),
    categoryTexts(db, locale, { ids: product.category ? [product.category.id] : [] }),
  ]);
  const category = product.category
    ? {
        ...product.category,
        name: categories.byId.get(product.category.id)?.name ?? product.category.name,
      }
    : null;
  return { ...product, ...texts.get(product.id), category };
}

/** Category links (navigation, lists): names in the shopper's language. */
export async function localizeCategoryLinks<T extends { id: string; name: string }>(
  db: TenantDb,
  locale: Locale,
  links: readonly T[],
): Promise<T[]> {
  const { byId } = await categoryTexts(db, locale, { ids: links.map((l) => l.id) });
  if (byId.size === 0) return [...links];
  return links.map((link) => ({ ...link, name: byId.get(link.id)?.name ?? link.name }));
}

/** A category page: its name, description, sub-categories and breadcrumbs. */
export async function localizeCategory(
  db: TenantDb,
  locale: Locale,
  category: PublicCategory,
): Promise<PublicCategory> {
  if (!isTranslated(locale)) return category;
  const { byId, bySlug } = await categoryTexts(db, locale, {
    ids: [category.id, ...category.children.map((c) => c.id)],
    slugs: category.ancestors.map((a) => a.slug),
  });
  const own = byId.get(category.id);
  return {
    ...category,
    name: own?.name ?? category.name,
    description: own?.description ?? category.description,
    ancestors: category.ancestors.map((a) => ({ ...a, name: bySlug.get(a.slug)?.name ?? a.name })),
    children: category.children.map((c) => ({ ...c, name: byId.get(c.id)?.name ?? c.name })),
  };
}

// --- Admin --------------------------------------------------------------------

const LIMITS = { name: 200, shortDescription: 500, description: 20_000 } as const;
const CATEGORY_LIMITS = { name: 100, description: 5_000 } as const;

const clean = (value: unknown, multiline: boolean): string => {
  if (typeof value !== "string") return "";
  return multiline ? value.replace(/\r\n?/g, "\n").trim() : value.replace(/\s+/g, " ").trim();
};

function assertLocale(locale: unknown): asserts locale is TranslatedLocale {
  if (typeof locale !== "string" || !(TRANSLATED_LOCALES as readonly string[]).includes(locale)) {
    throw new CatalogError("invalid", "Choose a language to translate into.");
  }
}

/** A product's wording in another language, for the admin form (empty when not written). */
export async function getProductTranslation(
  db: TenantDb,
  context: RequestContext,
  productId: string,
  locale: Locale,
): Promise<ProductText> {
  assertPermission(context, "catalog.read");
  assertId(productId, "product");
  const row = isTranslated(locale)
    ? await db.run((tx) =>
        tx.productTranslation.findUnique({
          where: { productId_locale: { productId, locale } },
          select: { name: true, shortDescription: true, description: true },
        }),
      )
    : null;
  return row ?? { name: "", shortDescription: "", description: "" };
}

/** Saves a product's wording in another language; all empty removes it. */
export async function saveProductTranslation(
  db: TenantDb,
  context: RequestContext,
  productId: string,
  localeInput: unknown,
  input: { name?: unknown; shortDescription?: unknown; description?: unknown },
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(productId, "product");
  assertLocale(localeInput);
  const locale = localeInput;
  const text: ProductText = {
    name: clean(input.name, false),
    shortDescription: clean(input.shortDescription, true),
    description: clean(input.description, true),
  };
  if (text.name.length > LIMITS.name)
    throw new CatalogError(
      "invalid",
      "Shorten the Arabic name (200 characters at most).",
      "nameAr",
    );
  if (text.shortDescription.length > LIMITS.shortDescription)
    throw new CatalogError(
      "invalid",
      "Shorten the Arabic summary (500 characters at most).",
      "shortDescriptionAr",
    );
  if (text.description.length > LIMITS.description)
    throw new CatalogError(
      "invalid",
      "Shorten the Arabic description (20,000 characters at most).",
      "descriptionAr",
    );
  await db.run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundError("product");
    const where = { productId_locale: { productId, locale } };
    const empty = !text.name && !text.shortDescription && !text.description;
    if (empty) {
      await tx.productTranslation.deleteMany({ where: { productId, locale } });
    } else {
      await tx.productTranslation.upsert({
        where,
        create: { tenantId: db.tenantId, productId, locale, ...text },
        update: text,
      });
    }
    await audit(
      tx,
      context,
      "catalog.product_translated",
      { type: "product", id: productId },
      undefined,
      {
        locale,
        removed: empty,
      },
    );
  });
}

/** A category's wording in another language, for the admin form. */
export async function getCategoryTranslation(
  db: TenantDb,
  context: RequestContext,
  categoryId: string,
  locale: Locale,
): Promise<CategoryText> {
  assertPermission(context, "catalog.read");
  assertId(categoryId, "category");
  const row = isTranslated(locale)
    ? await db.run((tx) =>
        tx.categoryTranslation.findUnique({
          where: { categoryId_locale: { categoryId, locale } },
          select: { name: true, description: true },
        }),
      )
    : null;
  return row ?? { name: "", description: "" };
}

/** Saves a category's wording in another language; all empty removes it. */
export async function saveCategoryTranslation(
  db: TenantDb,
  context: RequestContext,
  categoryId: string,
  localeInput: unknown,
  input: { name?: unknown; description?: unknown },
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(categoryId, "category");
  assertLocale(localeInput);
  const locale = localeInput;
  const text: CategoryText = {
    name: clean(input.name, false),
    description: clean(input.description, true),
  };
  if (text.name.length > CATEGORY_LIMITS.name)
    throw new CatalogError(
      "invalid",
      "Shorten the Arabic name (100 characters at most).",
      "nameAr",
    );
  if (text.description.length > CATEGORY_LIMITS.description)
    throw new CatalogError(
      "invalid",
      "Shorten the Arabic description (5,000 characters at most).",
      "descriptionAr",
    );
  await db.run(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) throw new NotFoundError("category");
    const empty = !text.name && !text.description;
    if (empty) {
      await tx.categoryTranslation.deleteMany({ where: { categoryId, locale } });
    } else {
      await tx.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId, locale } },
        create: { tenantId: db.tenantId, categoryId, locale, ...text },
        update: text,
      });
    }
    await audit(
      tx,
      context,
      "catalog.category_translated",
      { type: "category", id: categoryId },
      undefined,
      { locale, removed: empty },
    );
  });
}
