import { Prisma, type AppTransaction } from "@ecom/db";
import { NotFoundError } from "../access/context";
import type { TenantDb } from "../access/tenant-db";
import { ASSET_SELECT, toStoredImage, type StoredImage } from "../media/assets";
import { isSlug } from "./slug";

// The catalog as shoppers see it. No sign-in and no permission: what protects
// these reads is that they run inside the tenant found from the host name
// (Row-Level Security) and that every query here asks only for products that
// are published and have at least one variant for sale.
//
// Nothing in this file selects a cost price, a draft, or an archived product.

export const PUBLIC_PAGE_SIZE = 24;
const MAX_PAGE = 500;
const MAX_FILTER_VALUES = 20;

export const PUBLIC_SORTS = ["relevance", "newest", "price_asc", "price_desc", "name"] as const;
export type PublicSort = (typeof PUBLIC_SORTS)[number];

export const PRODUCT_FLAGS = ["featured", "new", "best_seller"] as const;
export type ProductFlag = (typeof PRODUCT_FLAGS)[number];

export interface PublicProductCard {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  /** What the cheapest variant costs now, in minor units. */
  priceAmount: number;
  currency: string;
  /** Other variants cost more: show "from". */
  priceVaries: boolean;
  /**
   * The regular price of that same variant when it is on sale; null when it
   * is not. This is the store's own current list price, not a claimed
   * earlier price (see decision D37).
   */
  regularPriceAmount: number | null;
  isNewArrival: boolean;
  isBestSeller: boolean;
  colors: string[];
  image: (StoredImage & { altText: string }) | null;
}

export interface PublicFacets {
  brands: { slug: string; name: string; count: number }[];
  colors: { value: string; count: number }[];
  /** Lowest and highest current price in the unfiltered list. */
  price: { min: number; max: number; currency: string } | null;
}

export interface PublicProductList {
  items: PublicProductCard[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  facets: PublicFacets;
}

export interface PublicListInput {
  /** Products in this category or any category beneath it. */
  categoryId?: string;
  search?: string;
  flag?: ProductFlag;
  brandSlugs?: readonly string[];
  /** Compared without regard to letter case. */
  colors?: readonly string[];
  /** Minor units, inclusive. */
  priceMin?: number | null;
  priceMax?: number | null;
  sort?: PublicSort;
  page?: number;
  pageSize?: number;
  /** Skip the facet queries (home page sections do not show filters). */
  withoutFacets?: boolean;
}

// --- Search ------------------------------------------------------------------

const MAX_SEARCH_LENGTH = 100;
const MAX_SEARCH_TERMS = 8;

/** The words of a search, lowercased; everything that is not a letter or digit separates words. */
export function searchTerms(search: string | undefined | null): string[] {
  if (!search) return [];
  return (
    search
      .slice(0, MAX_SEARCH_LENGTH)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, MAX_SEARCH_TERMS) ?? []
  );
}

/**
 * A full-text query in which every word must appear, each matching as a
 * prefix ("tot" finds "tote"). Built only from letters and digits, so no
 * search operator typed by a shopper is ever interpreted.
 */
export function prefixQuery(terms: readonly string[]): string {
  return terms.map((term) => `${term}:*`).join(" & ");
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

// --- Product lists -----------------------------------------------------------

const and = (parts: Prisma.Sql[]) =>
  parts.length > 0 ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;

/** The category and every category beneath it. */
async function categoryWithDescendants(tx: AppTransaction, categoryId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id, 0 AS depth FROM categories WHERE id = ${categoryId}::uuid
      UNION ALL
      SELECT c.id, tree.depth + 1 FROM categories c JOIN tree ON c.parent_id = tree.id
      WHERE tree.depth < 50
    )
    SELECT id FROM tree`;
  return rows.map((row) => row.id);
}

const FLAG_SQL: Record<ProductFlag, Prisma.Sql> = {
  featured: Prisma.sql`p.is_featured`,
  new: Prisma.sql`p.is_new_arrival`,
  best_seller: Prisma.sql`p.is_best_seller`,
};

const clampInt = (value: number | undefined, min: number, max: number, fallback: number) =>
  Number.isInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback;

const amount = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value
    : null;

export async function listPublicProducts(
  db: TenantDb,
  input: PublicListInput = {},
): Promise<PublicProductList> {
  return db.run((tx) => listProductsIn(tx, input));
}

export interface HomeSections {
  categories: PublicCategoryLink[];
  featured: PublicProductCard[];
  newArrivals: PublicProductCard[];
  bestSellers: PublicProductCard[];
  /** The newest products, for a store that has not flagged anything yet. */
  latest: PublicProductCard[];
}

/**
 * Everything the home page shows, read in one transaction so a page view
 * uses one database connection instead of one per section.
 */
export async function loadHomeSections(db: TenantDb, sectionSize = 8): Promise<HomeSections> {
  return db.run(async (tx) => {
    const section = async (flag?: ProductFlag) =>
      (await listProductsIn(tx, { flag, pageSize: sectionSize, withoutFacets: true })).items;
    const categories = await topCategoriesIn(tx);
    const featured = await section("featured");
    const newArrivals = await section("new");
    const bestSellers = await section("best_seller");
    const nothingFlagged = featured.length + newArrivals.length + bestSellers.length === 0;
    return {
      categories,
      featured,
      newArrivals,
      bestSellers,
      latest: nothingFlagged ? await section() : [],
    };
  });
}

async function listProductsIn(
  tx: AppTransaction,
  input: PublicListInput,
): Promise<PublicProductList> {
  const page = clampInt(input.page, 1, MAX_PAGE, 1);
  const pageSize = clampInt(input.pageSize, 1, 48, PUBLIC_PAGE_SIZE);
  const terms = searchTerms(input.search);
  const sort: PublicSort =
    input.sort && PUBLIC_SORTS.includes(input.sort)
      ? input.sort === "relevance" && terms.length === 0
        ? "newest"
        : input.sort
      : terms.length > 0
        ? "relevance"
        : "newest";
  const brandSlugs = [...new Set(input.brandSlugs ?? [])]
    .filter(isSlug)
    .slice(0, MAX_FILTER_VALUES);
  const colors = [...new Set((input.colors ?? []).map((color) => color.trim().toLowerCase()))]
    .filter((color) => color !== "" && color.length <= 60)
    .slice(0, MAX_FILTER_VALUES);
  const priceMin = amount(input.priceMin);
  const priceMax = amount(input.priceMax);

  {
    // "base" is everything the page is about (category, search, flag);
    // filters narrow it, and the filter options are counted over the base.
    const baseWhere: Prisma.Sql[] = [];
    if (input.categoryId) {
      const ids = await categoryWithDescendants(tx, input.categoryId);
      baseWhere.push(Prisma.sql`p.category_id = ANY(${ids}::uuid[])`);
    }
    if (input.flag) baseWhere.push(FLAG_SQL[input.flag]);

    let rank = Prisma.sql`0::real`;
    if (terms.length > 0) {
      const query = Prisma.sql`to_tsquery('simple', ${prefixQuery(terms)})`;
      // SKUs and brand names are matched as typed (a SKU has hyphens), from the start.
      const phrase = `${escapeLike((input.search ?? "").trim().slice(0, MAX_SEARCH_LENGTH))}%`;
      rank = Prisma.sql`ts_rank(p.search_vector, ${query})`;
      baseWhere.push(Prisma.sql`(
        p.search_vector @@ ${query}
        OR EXISTS (
          SELECT 1 FROM product_variants s
          WHERE s.product_id = p.id AND s.status = 'active' AND s.sku ILIKE ${phrase}
        )
        OR EXISTS (SELECT 1 FROM brands sb WHERE sb.id = p.brand_id AND sb.name ILIKE ${phrase})
      )`);
    }

    const base = Prisma.sql`
      SELECT p.id, p.name, p.created_at, p.brand_id, ${rank} AS rank,
             min(coalesce(v.discount_price_amount, v.price_amount)) AS price,
             min(v.currency) AS currency
      FROM products p
      JOIN product_variants v ON v.product_id = p.id AND v.status = 'active'
      WHERE p.status = 'active' ${and(baseWhere)}
      GROUP BY p.id`;

    const filters: Prisma.Sql[] = [];
    if (brandSlugs.length > 0) {
      filters.push(
        Prisma.sql`b.brand_id IN (SELECT id FROM brands WHERE slug = ANY(${brandSlugs}::text[]))`,
      );
    }
    if (colors.length > 0) {
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_variants cv
        WHERE cv.product_id = b.id AND cv.status = 'active'
          AND lower(cv.color) = ANY(${colors}::text[])
      )`);
    }
    if (priceMin !== null) filters.push(Prisma.sql`b.price >= ${priceMin}`);
    if (priceMax !== null) filters.push(Prisma.sql`b.price <= ${priceMax}`);

    const order = {
      relevance: Prisma.sql`b.rank DESC, b.created_at DESC, b.id`,
      newest: Prisma.sql`b.created_at DESC, b.id`,
      price_asc: Prisma.sql`b.price ASC, b.name, b.id`,
      price_desc: Prisma.sql`b.price DESC, b.name, b.id`,
      name: Prisma.sql`lower(b.name), b.id`,
    }[sort];

    const found = await tx.$queryRaw<{ id: string; total: bigint }[]>`
      WITH base AS (${base})
      SELECT b.id, count(*) OVER () AS total
      FROM base b
      WHERE true ${and(filters)}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

    let total = Number(found[0]?.total ?? 0);
    if (found.length === 0 && page > 1) {
      // Past the last page: report how many there are so the page can say so.
      const counted = await tx.$queryRaw<{ total: bigint }[]>`
        WITH base AS (${base})
        SELECT count(*) AS total FROM base b WHERE true ${and(filters)}`;
      total = Number(counted[0]?.total ?? 0);
    }

    const ids = found.map((row) => row.id);
    const items = await loadCards(tx, ids);

    let facets: PublicFacets = { brands: [], colors: [], price: null };
    if (!input.withoutFacets) {
      const brands = await tx.$queryRaw<{ slug: string; name: string; count: bigint }[]>`
        WITH base AS (${base})
        SELECT br.slug, br.name, count(*) AS count
        FROM base b JOIN brands br ON br.id = b.brand_id
        GROUP BY br.id ORDER BY br.name`;
      const colorRows = await tx.$queryRaw<{ value: string; count: bigint }[]>`
        WITH base AS (${base})
        SELECT min(cv.color) AS value, count(DISTINCT b.id) AS count
        FROM base b
        JOIN product_variants cv ON cv.product_id = b.id AND cv.status = 'active'
        WHERE cv.color IS NOT NULL AND btrim(cv.color) <> ''
        GROUP BY lower(cv.color) ORDER BY lower(cv.color) LIMIT 40`;
      const range = await tx.$queryRaw<
        { min: number | null; max: number | null; currency: string | null }[]
      >`
        WITH base AS (${base})
        SELECT min(b.price)::int AS min, max(b.price)::int AS max, min(b.currency) AS currency
        FROM base b`;
      const bounds = range[0];
      facets = {
        brands: brands.map((row) => ({ ...row, count: Number(row.count) })),
        colors: colorRows.map((row) => ({ value: row.value, count: Number(row.count) })),
        price:
          bounds && bounds.min !== null && bounds.max !== null && bounds.currency
            ? { min: bounds.min, max: bounds.max, currency: bounds.currency }
            : null,
      };
    }

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      facets,
    };
  }
}

/** Card data for the given products, in the given order. */
async function loadCards(tx: AppTransaction, ids: readonly string[]): Promise<PublicProductCard[]> {
  if (ids.length === 0) return [];
  const rows = await tx.product.findMany({
    // The status is repeated here so this function is safe on its own.
    where: { id: { in: [...ids] }, status: "active" },
    select: {
      id: true,
      slug: true,
      name: true,
      isNewArrival: true,
      isBestSeller: true,
      brand: { select: { name: true } },
      variants: {
        where: { status: "active" },
        select: { priceAmount: true, discountPriceAmount: true, currency: true, color: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
      images: {
        select: { altText: true, asset: { select: ASSET_SELECT } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: 1,
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cards: PublicProductCard[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.variants.length === 0) continue;
    const priced = row.variants.map((variant) => ({
      ...variant,
      current: variant.discountPriceAmount ?? variant.priceAmount,
    }));
    const cheapest = priced.reduce((low, variant) =>
      variant.current < low.current ? variant : low,
    );
    const seen = new Set<string>();
    const colors: string[] = [];
    for (const variant of row.variants) {
      const color = variant.color?.trim();
      if (color && !seen.has(color.toLowerCase())) {
        seen.add(color.toLowerCase());
        colors.push(color);
      }
    }
    const image = row.images[0];
    cards.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      brandName: row.brand?.name ?? null,
      priceAmount: cheapest.current,
      currency: cheapest.currency,
      priceVaries: priced.some((variant) => variant.current !== cheapest.current),
      regularPriceAmount: cheapest.discountPriceAmount !== null ? cheapest.priceAmount : null,
      isNewArrival: row.isNewArrival,
      isBestSeller: row.isBestSeller,
      colors,
      image: image ? { ...toStoredImage(image.asset), altText: image.altText } : null,
    });
  }
  return cards;
}

// --- Categories --------------------------------------------------------------

export interface PublicCategoryLink {
  id: string;
  name: string;
  slug: string;
  image: StoredImage | null;
}

export interface PublicCategory extends PublicCategoryLink {
  description: string;
  seoTitle: string | null;
  seoDescription: string | null;
  /** From the top of the tree down to this category's parent. */
  ancestors: { name: string; slug: string }[];
  children: PublicCategoryLink[];
}

const CATEGORY_LINK = {
  id: true,
  name: true,
  slug: true,
  image: { select: ASSET_SELECT },
} as const;

const toLink = (row: {
  id: string;
  name: string;
  slug: string;
  image: Parameters<typeof toStoredImage>[0] | null;
}): PublicCategoryLink => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  image: row.image ? toStoredImage(row.image) : null,
});

const CATEGORY_ORDER = [{ position: "asc" as const }, { name: "asc" as const }];

/** Top-level categories, for the navigation and the home page. */
export async function listTopCategories(db: TenantDb): Promise<PublicCategoryLink[]> {
  return db.run(topCategoriesIn);
}

async function topCategoriesIn(tx: AppTransaction): Promise<PublicCategoryLink[]> {
  const rows = await tx.category.findMany({
    where: { parentId: null },
    select: CATEGORY_LINK,
    orderBy: CATEGORY_ORDER,
  });
  return rows.map(toLink);
}

export async function getPublicCategory(db: TenantDb, slug: string): Promise<PublicCategory> {
  if (!isSlug(slug)) throw new NotFoundError("category");
  return db.run(async (tx) => {
    const row = await tx.category.findUnique({
      where: { tenantId_slug: { tenantId: db.tenantId, slug } },
      select: {
        ...CATEGORY_LINK,
        parentId: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        children: { select: CATEGORY_LINK, orderBy: CATEGORY_ORDER },
      },
    });
    if (!row) throw new NotFoundError("category");

    const ancestors: { name: string; slug: string }[] = [];
    let cursor = row.parentId;
    for (let depth = 0; cursor !== null && depth < 50; depth += 1) {
      const parent: { name: string; slug: string; parentId: string | null } | null =
        await tx.category.findUnique({
          where: { id: cursor },
          select: { name: true, slug: true, parentId: true },
        });
      if (!parent) break;
      ancestors.unshift({ name: parent.name, slug: parent.slug });
      cursor = parent.parentId;
    }

    return {
      ...toLink(row),
      description: row.description,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      ancestors,
      children: row.children.map(toLink),
    };
  });
}

// --- One product -------------------------------------------------------------

export interface PublicVariant {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  priceAmount: number;
  /** Regular price when the variant is on sale; null otherwise. */
  regularPriceAmount: number | null;
  currency: string;
}

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  seoTitle: string | null;
  seoDescription: string | null;
  material: string | null;
  careInfo: string | null;
  brandName: string | null;
  category: { name: string; slug: string } | null;
  isNewArrival: boolean;
  isBestSeller: boolean;
  attributes: { key: string; value: string }[];
  variants: PublicVariant[];
  images: { altText: string; variantId: string | null; image: StoredImage }[];
}

/** A published product by its URL name. Drafts and archived products are "not found". */
export async function getPublicProduct(db: TenantDb, slug: string): Promise<PublicProduct> {
  if (!isSlug(slug)) throw new NotFoundError("product");
  const row = await db.run((tx) =>
    tx.product.findFirst({
      where: { slug, status: "active", variants: { some: { status: "active" } } },
      select: {
        id: true,
        slug: true,
        name: true,
        shortDescription: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        material: true,
        careInfo: true,
        isNewArrival: true,
        isBestSeller: true,
        brand: { select: { name: true } },
        category: { select: { name: true, slug: true } },
        attributes: { select: { key: true, value: true }, orderBy: { position: "asc" } },
        variants: {
          where: { status: "active" },
          select: {
            id: true,
            sku: true,
            color: true,
            size: true,
            priceAmount: true,
            discountPriceAmount: true,
            currency: true,
          },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        },
        images: {
          select: { altText: true, variantId: true, asset: { select: ASSET_SELECT } },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
  );
  if (!row) throw new NotFoundError("product");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    description: row.description,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    material: row.material,
    careInfo: row.careInfo,
    brandName: row.brand?.name ?? null,
    category: row.category,
    isNewArrival: row.isNewArrival,
    isBestSeller: row.isBestSeller,
    attributes: row.attributes,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      size: variant.size,
      priceAmount: variant.discountPriceAmount ?? variant.priceAmount,
      regularPriceAmount: variant.discountPriceAmount !== null ? variant.priceAmount : null,
      currency: variant.currency,
    })),
    images: row.images.map((image) => ({
      altText: image.altText,
      variantId: image.variantId,
      image: toStoredImage(image.asset),
    })),
  };
}
