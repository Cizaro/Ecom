import type { AiGateway, ItemCopyOutput, ItemTranslateOutput, KnowledgeSource } from "@ecom/ai";
import type { Locale } from "@ecom/i18n";
import type { AppTransaction, Prisma } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { assertId, CatalogError, isUniqueViolation } from "../catalog/errors";
import { TRANSLATED_LOCALES } from "../catalog/translations";
import { storeLanguages } from "../tenancy/store-host";
import { getBusinessProfile } from "./ai-admin";

// AI drafts for products (Milestone 5.2): the wording, search-engine text,
// tags and category from the product's own details, and an Arabic draft of
// its name and descriptions. A draft is only a suggestion: staff apply the
// parts they want, or dismiss it (decision D99). Drafting and deciding need
// catalog.write and ai.use; seeing waiting drafts needs catalog.read and ai.use.

export type SuggestionKind = "copy" | "translation";

/** The parts of a copy draft staff can apply, by product field. */
export const COPY_FIELDS = [
  "shortDescription",
  "description",
  "seoTitle",
  "seoDescription",
  "tags",
  "category",
] as const;
/** The parts of a translation draft staff can apply. */
export const TRANSLATION_FIELDS = ["name", "shortDescription", "description"] as const;

export type CopyField = (typeof COPY_FIELDS)[number];
export type TranslationField = (typeof TRANSLATION_FIELDS)[number];

export interface CopyProposal {
  shortDescription: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  categoryId: string | null;
}
export type TranslationProposal = Record<TranslationField, string>;

export type ProductSuggestionView =
  | {
      id: string;
      kind: "copy";
      locale: string;
      createdAt: Date;
      proposal: CopyProposal;
      /** The suggested category's name, when it still exists. */
      categoryName: string | null;
    }
  | {
      id: string;
      kind: "translation";
      locale: string;
      createdAt: Date;
      proposal: TranslationProposal;
    };

export type DraftResult = { ok: true; id: string } | { ok: false; message: string };

const MAX_TAGS = 20;

/** Content drafts use only the product's own details, never the shop's other facts. */
const NO_KNOWLEDGE: KnowledgeSource = { abilities: () => [], search: async () => [] };

function assertCanDraft(context: RequestContext) {
  assertPermission(context, "catalog.write");
  assertPermission(context, "ai.use");
}

async function storeFor(db: TenantDb) {
  return db.run(async (tx) => {
    const store = await tx.store.findFirst({
      select: { defaultLocale: true, languages: true },
      orderBy: { createdAt: "asc" },
    });
    const languages = storeLanguages(store?.defaultLocale ?? "en", store?.languages ?? []);
    return { defaultLocale: languages.defaultLocale as string };
  });
}

/** Saves a checked draft, replacing any waiting draft of the same kind and language. */
async function saveDraft(
  db: TenantDb,
  context: RequestContext,
  productId: string,
  kind: SuggestionKind,
  locale: string,
  proposal: CopyProposal | TranslationProposal,
  aiEventId: string,
): Promise<DraftResult> {
  try {
    const id = await db.run(async (tx) => {
      const now = new Date();
      await tx.productSuggestion.updateMany({
        where: { productId, kind, locale, status: "pending" },
        data: { status: "replaced", decidedAt: now, decidedByUserId: context.userId },
      });
      const created = await tx.productSuggestion.create({
        data: {
          tenantId: db.tenantId,
          productId,
          kind,
          locale,
          proposal: proposal as unknown as Prisma.InputJsonObject,
          aiEventId,
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "ai.product_draft_created",
        { type: "product", id: productId },
        undefined,
        {
          suggestionId: created.id,
          kind,
          locale,
        },
      );
      return created.id;
    });
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, message: "Another draft was made at the same moment. Reload the page." };
    }
    throw error;
  }
}

/** Drafts the product's wording, search-engine text, tags and category. */
export async function draftProductCopy(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  productId: string,
): Promise<DraftResult> {
  assertCanDraft(context);
  assertId(productId, "product");
  const [product, categories, { defaultLocale }, profile] = await Promise.all([
    db.run((tx) =>
      tx.product.findUnique({
        where: { id: productId },
        select: {
          name: true,
          shortDescription: true,
          description: true,
          categoryId: true,
          audienceTags: true,
          material: true,
          careInfo: true,
          brand: { select: { name: true } },
          category: { select: { name: true } },
          attributes: { select: { key: true, value: true }, orderBy: { position: "asc" } },
        },
      }),
    ),
    db.run((tx) =>
      tx.category.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
    ),
    storeFor(db),
    getBusinessProfile(db),
  ]);
  if (!product) throw new NotFoundError("product");

  const details = [
    ...product.attributes.map((a) => ({ label: a.key, value: a.value })),
    ...(product.material ? [{ label: "Material", value: product.material }] : []),
    ...(product.careInfo ? [{ label: "Care", value: product.careInfo }] : []),
  ].slice(0, 50);
  const result = await gateway.run(
    "item.copy",
    {
      language: defaultLocale,
      item: {
        name: product.name,
        group: product.category?.name ?? "",
        maker: product.brand?.name ?? "",
        details,
        summary: product.shortDescription,
        description: product.description,
      },
      groups: categories,
      currentGroupId: product.categoryId,
      currentTags: product.audienceTags,
    },
    {
      tenantId: db.tenantId,
      profile,
      knowledge: NO_KNOWLEDGE,
    },
  );
  if (!result.ok) return { ok: false, message: result.message };
  const output: ItemCopyOutput = result.output;
  return saveDraft(
    db,
    context,
    productId,
    "copy",
    defaultLocale,
    {
      shortDescription: output.summary,
      description: output.description,
      seoTitle: output.seoTitle,
      seoDescription: output.seoDescription,
      tags: [...new Set(output.tags.map((tag) => tag.toLowerCase()))],
      categoryId: output.groupId,
    },
    result.eventId,
  );
}

/** Drafts the product's name and descriptions in another language (Arabic). */
export async function draftProductTranslation(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  productId: string,
  localeInput: unknown,
): Promise<DraftResult> {
  assertCanDraft(context);
  assertId(productId, "product");
  const locale = TRANSLATED_LOCALES.find((l) => l === localeInput);
  if (!locale) throw new CatalogError("invalid", "Choose a language to translate into.", "locale");
  const [product, { defaultLocale }, profile] = await Promise.all([
    db.run((tx) =>
      tx.product.findUnique({
        where: { id: productId },
        select: { name: true, shortDescription: true, description: true },
      }),
    ),
    storeFor(db),
    getBusinessProfile(db),
  ]);
  if (!product) throw new NotFoundError("product");
  if (defaultLocale === locale) {
    throw new CatalogError("invalid", "The product is already written in this language.", "locale");
  }
  const result = await gateway.run(
    "item.translate",
    {
      from: defaultLocale,
      to: locale,
      text: {
        name: product.name,
        summary: product.shortDescription,
        description: product.description,
      },
    },
    {
      tenantId: db.tenantId,
      profile,
      knowledge: NO_KNOWLEDGE,
    },
  );
  if (!result.ok) return { ok: false, message: result.message };
  const output: ItemTranslateOutput = result.output;
  return saveDraft(
    db,
    context,
    productId,
    "translation",
    locale,
    { name: output.name, shortDescription: output.summary, description: output.description },
    result.eventId,
  );
}

/** Drafts waiting for a decision on a product, newest first. Empty without ai.use. */
export async function listProductSuggestions(
  db: TenantDb,
  context: RequestContext,
  productId: string,
): Promise<ProductSuggestionView[]> {
  assertPermission(context, "catalog.read");
  assertId(productId, "product");
  if (!context.permissions.has("ai.use")) return [];
  const rows = await db.run((tx) =>
    tx.productSuggestion.findMany({
      where: { productId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, locale: true, createdAt: true, proposal: true },
    }),
  );
  const categoryIds = rows
    .filter((row) => row.kind === "copy")
    .map((row) => (row.proposal as unknown as CopyProposal).categoryId)
    .filter((id): id is string => id !== null);
  const categories =
    categoryIds.length > 0
      ? await db.run((tx) =>
          tx.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          }),
        )
      : [];
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return rows.map((row) => {
    if (row.kind === "copy") {
      const proposal = row.proposal as unknown as CopyProposal;
      return {
        id: row.id,
        kind: "copy" as const,
        locale: row.locale,
        createdAt: row.createdAt,
        proposal,
        categoryName: proposal.categoryId ? (names.get(proposal.categoryId) ?? null) : null,
      };
    }
    return {
      id: row.id,
      kind: "translation" as const,
      locale: row.locale,
      createdAt: row.createdAt,
      proposal: row.proposal as unknown as TranslationProposal,
    };
  });
}

async function pendingSuggestion(tx: AppTransaction, productId: string, suggestionId: string) {
  const row = await tx.productSuggestion.findFirst({
    where: { id: suggestionId, productId },
    select: { id: true, kind: true, locale: true, status: true, proposal: true },
  });
  if (!row) throw new NotFoundError("suggestion");
  if (row.status !== "pending") {
    throw new CatalogError("invalid", "This draft was already applied, dismissed or replaced.");
  }
  return row;
}

/**
 * Applies the chosen parts of a waiting draft to the product. Tags are added
 * to the product's own; a translation only replaces the chosen parts.
 */
export async function applyProductSuggestion(
  db: TenantDb,
  context: RequestContext,
  productId: string,
  suggestionId: string,
  fieldsInput: unknown,
): Promise<void> {
  assertCanDraft(context);
  assertId(productId, "product");
  assertId(suggestionId, "suggestion");
  const requested = Array.isArray(fieldsInput)
    ? fieldsInput.filter((f): f is string => typeof f === "string")
    : [];
  await db.run(async (tx) => {
    const row = await pendingSuggestion(tx, productId, suggestionId);
    const allowed: readonly string[] = row.kind === "copy" ? COPY_FIELDS : TRANSLATION_FIELDS;
    const fields = allowed.filter((field) => requested.includes(field));
    if (fields.length === 0) {
      throw new CatalogError("invalid", "Tick at least one part of the draft to apply.", "fields");
    }

    if (row.kind === "copy") {
      const proposal = row.proposal as unknown as CopyProposal;
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { audienceTags: true },
      });
      if (!product) throw new NotFoundError("product");
      const data: Prisma.ProductUncheckedUpdateInput = {};
      if (fields.includes("shortDescription")) data.shortDescription = proposal.shortDescription;
      if (fields.includes("description")) data.description = proposal.description;
      if (fields.includes("seoTitle")) data.seoTitle = proposal.seoTitle;
      if (fields.includes("seoDescription")) data.seoDescription = proposal.seoDescription;
      if (fields.includes("tags")) {
        data.audienceTags = [...new Set([...product.audienceTags, ...proposal.tags])].slice(
          0,
          MAX_TAGS,
        );
      }
      if (fields.includes("category")) {
        if (!proposal.categoryId) {
          throw new CatalogError("invalid", "The draft suggests no category.", "fields");
        }
        const category = await tx.category.findUnique({
          where: { id: proposal.categoryId },
          select: { id: true },
        });
        if (!category) {
          throw new CatalogError(
            "unknown_reference",
            "The suggested category no longer exists.",
            "fields",
          );
        }
        data.categoryId = proposal.categoryId;
      }
      await tx.product.update({ where: { id: productId }, data });
    } else {
      const proposal = row.proposal as unknown as TranslationProposal;
      const locale = row.locale as Locale;
      const existing = await tx.productTranslation.findUnique({
        where: { productId_locale: { productId, locale } },
        select: { name: true, shortDescription: true, description: true },
      });
      const text = { name: "", shortDescription: "", description: "", ...existing };
      for (const field of fields as TranslationField[]) text[field] = proposal[field];
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId, locale } },
        create: { tenantId: db.tenantId, productId, locale, ...text },
        update: text,
      });
    }

    await tx.productSuggestion.update({
      where: { id: row.id },
      data: {
        status: "applied",
        appliedFields: fields,
        decidedAt: new Date(),
        decidedByUserId: context.userId,
      },
    });
    await audit(
      tx,
      context,
      "ai.product_draft_applied",
      { type: "product", id: productId },
      undefined,
      {
        suggestionId: row.id,
        kind: row.kind,
        locale: row.locale,
        fields,
      },
    );
  });
}

/** Dismisses a waiting draft; the product is unchanged. */
export async function dismissProductSuggestion(
  db: TenantDb,
  context: RequestContext,
  productId: string,
  suggestionId: string,
): Promise<void> {
  assertCanDraft(context);
  assertId(productId, "product");
  assertId(suggestionId, "suggestion");
  await db.run(async (tx) => {
    const row = await pendingSuggestion(tx, productId, suggestionId);
    await tx.productSuggestion.update({
      where: { id: row.id },
      data: { status: "dismissed", decidedAt: new Date(), decidedByUserId: context.userId },
    });
    await audit(
      tx,
      context,
      "ai.product_draft_dismissed",
      { type: "product", id: productId },
      undefined,
      {
        suggestionId: row.id,
        kind: row.kind,
      },
    );
  });
}
