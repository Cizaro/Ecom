import type { AiGateway } from "@ecom/ai";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { getBusinessProfile } from "../ai/ai-admin";
import { createCommerceKnowledge } from "../ai/commerce-knowledge";
import { formatMoney, parseMoney } from "../catalog/money";
import { parseBranding } from "../tenancy/branding";

// Competitor research (Milestone 7.2, decision D108). Staff record what they
// see competitors do and sell, by hand, with where and when they saw it:
// nothing is collected automatically, so no site's rules, logins or limits
// are ever worked around. AI turns the observations into scored ideas, kept
// apart and always shown as suggestions with the observations they cite.
// Everything needs research.write; drafting ideas also needs ai.use.

export const RESEARCH_KINDS = [
  "product",
  "price",
  "promotion",
  "post",
  "hook",
  "hashtag",
  "review",
  "other",
] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];
export const IDEA_STATUSES = ["new", "accepted", "dismissed"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export class ResearchError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ResearchError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertId = (id: string, what: string) => {
  if (!UUID.test(id)) throw new NotFoundError(what);
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** An http(s) address from what was typed ("shop.example" becomes https://shop.example/). */
function webAddress(value: unknown, field: string, max = 500): string | null {
  const raw = text(value).trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ResearchError("Enter a web address, like https://example.com.", field);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) {
    throw new ResearchError("Enter a web address, like https://example.com.", field);
  }
  const href = url.toString();
  if (href.length > max) throw new ResearchError("That address is too long.", field);
  return href;
}

/** An Instagram or TikTok name from "@name", "name" or a profile address. */
export function socialHandle(value: unknown, field: string): string | null {
  let raw = text(value).trim();
  if (!raw) return null;
  const fromUrl = /(?:instagram\.com|tiktok\.com)\/@?([A-Za-z0-9._]+)/i.exec(raw);
  if (fromUrl) raw = fromUrl[1]!;
  raw = raw.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(raw)) {
    throw new ResearchError("Enter the account name, like @example.", field);
  }
  return raw;
}

async function storeCurrency(db: TenantDb): Promise<string> {
  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
  );
  return store?.defaultCurrency ?? "USD";
}

const duplicate = (error: unknown) =>
  error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002";

// --- Competitors -----------------------------------------------------------------

export interface CompetitorInput {
  name: unknown;
  website?: unknown;
  instagram?: unknown;
  facebook?: unknown;
  tiktok?: unknown;
  tags?: unknown;
  notes?: unknown;
  archived?: unknown;
}

function cleanCompetitor(input: CompetitorInput) {
  const name = text(input.name).replace(/\s+/g, " ").trim();
  if (!name) throw new ResearchError("Give the competitor a name.", "name");
  if (name.length > 120)
    throw new ResearchError("Shorten the name (120 characters at most).", "name");
  const notes = text(input.notes).replace(/\r\n?/g, "\n").trim();
  if (notes.length > 2000)
    throw new ResearchError("Shorten the notes (2,000 characters at most).", "notes");
  const tags = [
    ...new Set(
      text(input.tags)
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) {
    throw new ResearchError("Use up to 20 tags, separated by commas.", "tags");
  }
  return {
    name,
    website: webAddress(input.website, "website"),
    facebook: webAddress(input.facebook, "facebook"),
    instagram: socialHandle(input.instagram, "instagram"),
    tiktok: socialHandle(input.tiktok, "tiktok"),
    tags,
    notes,
  };
}

export async function saveCompetitor(
  db: TenantDb,
  context: RequestContext,
  id: string | null,
  input: CompetitorInput,
): Promise<{ id: string }> {
  assertPermission(context, "research.write");
  const data = cleanCompetitor(input);
  const archived = input.archived === true || input.archived === "on";
  try {
    return await db.run(async (tx) => {
      if (id) {
        assertId(id, "competitor");
        const before = await tx.competitor.findUnique({
          where: { id },
          select: { archivedAt: true },
        });
        if (!before) throw new NotFoundError("competitor");
        await tx.competitor.update({
          where: { id },
          data: { ...data, archivedAt: archived ? (before.archivedAt ?? new Date()) : null },
        });
        await audit(tx, context, "research.competitor_updated", { type: "competitor", id });
        return { id };
      }
      const created = await tx.competitor.create({
        data: { tenantId: db.tenantId, ...data, createdByUserId: context.userId },
        select: { id: true },
      });
      await audit(tx, context, "research.competitor_added", {
        type: "competitor",
        id: created.id,
      });
      return created;
    });
  } catch (error) {
    if (duplicate(error)) {
      throw new ResearchError("A competitor with this name is already listed.", "name");
    }
    throw error;
  }
}

export interface CompetitorSummary {
  id: string;
  name: string;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  tags: string[];
  notes: string;
  archived: boolean;
  observationCount: number;
  lastObservedOn: string | null;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

export async function listCompetitors(
  db: TenantDb,
  context: RequestContext,
  input: { archived?: boolean } = {},
): Promise<CompetitorSummary[]> {
  assertPermission(context, "research.write");
  const rows = await db.run((tx) =>
    tx.competitor.findMany({
      where: { archivedAt: input.archived ? { not: null } : null },
      select: {
        id: true,
        name: true,
        website: true,
        instagram: true,
        facebook: true,
        tiktok: true,
        tags: true,
        notes: true,
        archivedAt: true,
        _count: { select: { observations: true } },
        observations: { select: { observedOn: true }, orderBy: { observedOn: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
      take: 200,
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    website: row.website,
    instagram: row.instagram,
    facebook: row.facebook,
    tiktok: row.tiktok,
    tags: row.tags,
    notes: row.notes,
    archived: row.archivedAt !== null,
    observationCount: row._count.observations,
    lastObservedOn: row.observations[0] ? day(row.observations[0].observedOn) : null,
  }));
}

// --- Observations -----------------------------------------------------------------

export interface Observation {
  id: string;
  kind: ResearchKind;
  title: string;
  detail: string;
  priceAmount: number | null;
  currency: string | null;
  sourceUrl: string | null;
  observedOn: string;
  competitor: { id: string; name: string };
  /** A similar product of ours, with its current lowest price. */
  ours: { id: string; name: string; priceAmount: number | null; currency: string | null } | null;
}

const OBSERVATION_SELECT = {
  id: true,
  kind: true,
  title: true,
  detail: true,
  priceAmount: true,
  currency: true,
  sourceUrl: true,
  observedOn: true,
  competitor: { select: { id: true, name: true } },
  product: {
    select: {
      id: true,
      name: true,
      variants: {
        where: { status: "active" as const },
        select: { priceAmount: true, discountPriceAmount: true, currency: true },
      },
    },
  },
} as const;

type ObservationRow = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  priceAmount: number | null;
  currency: string | null;
  sourceUrl: string | null;
  observedOn: Date;
  competitor: { id: string; name: string };
  product: {
    id: string;
    name: string;
    variants: { priceAmount: number; discountPriceAmount: number | null; currency: string }[];
  } | null;
};

function toObservation(row: ObservationRow): Observation {
  const prices = (row.product?.variants ?? [])
    .map((v) => ({ amount: v.discountPriceAmount ?? v.priceAmount, currency: v.currency }))
    .sort((a, b) => a.amount - b.amount);
  return {
    id: row.id,
    kind: row.kind as ResearchKind,
    title: row.title,
    detail: row.detail,
    priceAmount: row.priceAmount,
    currency: row.currency,
    sourceUrl: row.sourceUrl,
    observedOn: day(row.observedOn),
    competitor: row.competitor,
    ours: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          priceAmount: prices[0]?.amount ?? null,
          currency: prices[0]?.currency ?? null,
        }
      : null,
  };
}

export interface CompetitorView extends CompetitorSummary {
  observations: Observation[];
}

export async function getCompetitor(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<CompetitorView> {
  assertPermission(context, "research.write");
  assertId(id, "competitor");
  const summary = (await listCompetitorsById(db, id))[0];
  if (!summary) throw new NotFoundError("competitor");
  const rows = await db.run((tx) =>
    tx.researchObservation.findMany({
      where: { competitorId: id },
      select: OBSERVATION_SELECT,
      orderBy: [{ observedOn: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
  );
  return { ...summary, observations: rows.map((row) => toObservation(row as ObservationRow)) };
}

async function listCompetitorsById(db: TenantDb, id: string): Promise<CompetitorSummary[]> {
  const row = await db.run((tx) =>
    tx.competitor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        website: true,
        instagram: true,
        facebook: true,
        tiktok: true,
        tags: true,
        notes: true,
        archivedAt: true,
        _count: { select: { observations: true } },
        observations: { select: { observedOn: true }, orderBy: { observedOn: "desc" }, take: 1 },
      },
    }),
  );
  if (!row) return [];
  return [
    {
      id: row.id,
      name: row.name,
      website: row.website,
      instagram: row.instagram,
      facebook: row.facebook,
      tiktok: row.tiktok,
      tags: row.tags,
      notes: row.notes,
      archived: row.archivedAt !== null,
      observationCount: row._count.observations,
      lastObservedOn: row.observations[0] ? day(row.observations[0].observedOn) : null,
    },
  ];
}

export interface ObservationInput {
  kind: unknown;
  title: unknown;
  detail?: unknown;
  price?: unknown;
  sourceUrl?: unknown;
  observedOn?: unknown;
  productId?: unknown;
}

export async function addObservation(
  db: TenantDb,
  context: RequestContext,
  competitorId: string,
  input: ObservationInput,
): Promise<{ id: string }> {
  assertPermission(context, "research.write");
  assertId(competitorId, "competitor");
  const kind = RESEARCH_KINDS.find((value) => value === input.kind);
  if (!kind) throw new ResearchError("Choose what you saw.", "kind");
  const title = text(input.title).replace(/\s+/g, " ").trim();
  if (!title) throw new ResearchError("Say in a few words what you saw.", "title");
  if (title.length > 200) throw new ResearchError("Shorten it (200 characters at most).", "title");
  const detail = text(input.detail).replace(/\r\n?/g, "\n").trim();
  if (detail.length > 2000)
    throw new ResearchError("Shorten the details (2,000 characters at most).", "detail");
  const currency = await storeCurrency(db);
  const priceText = text(input.price).trim();
  let priceAmount: number | null = null;
  if (priceText) {
    priceAmount = parseMoney(priceText, currency);
    if (priceAmount === null)
      throw new ResearchError("Enter the price as an amount, like 45.", "price");
  }
  const sourceUrl = webAddress(input.sourceUrl, "sourceUrl", 1000);
  const dateText = text(input.observedOn).trim() || new Date().toISOString().slice(0, 10);
  const observedOn = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
    ? new Date(`${dateText}T00:00:00Z`)
    : null;
  if (!observedOn || Number.isNaN(observedOn.getTime()) || day(observedOn) !== dateText) {
    throw new ResearchError("Enter the date you saw it.", "observedOn");
  }
  if (observedOn.getTime() > Date.now() + 86_400_000) {
    throw new ResearchError("The date cannot be in the future.", "observedOn");
  }
  const productId = text(input.productId) || null;
  if (productId) assertId(productId, "product");

  return db.run(async (tx) => {
    const competitor = await tx.competitor.findUnique({
      where: { id: competitorId },
      select: { id: true },
    });
    if (!competitor) throw new NotFoundError("competitor");
    if (productId) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new ResearchError("That product no longer exists.", "productId");
    }
    const created = await tx.researchObservation.create({
      data: {
        tenantId: db.tenantId,
        competitorId,
        kind,
        title,
        detail,
        priceAmount,
        currency: priceAmount === null ? null : currency,
        productId,
        sourceUrl,
        observedOn,
        createdByUserId: context.userId,
      },
      select: { id: true },
    });
    await audit(tx, context, "research.observation_added", {
      type: "research_observation",
      id: created.id,
    });
    return created;
  });
}

export async function deleteObservation(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<void> {
  assertPermission(context, "research.write");
  assertId(id, "observation");
  await db.run(async (tx) => {
    const deleted = await tx.researchObservation.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new NotFoundError("observation");
    await audit(tx, context, "research.observation_deleted", { type: "research_observation", id });
  });
}

/** Recent observations across competitors, newest first (for the research page). */
export async function recentObservations(
  db: TenantDb,
  context: RequestContext,
  input: { kind?: string; limit?: number } = {},
): Promise<Observation[]> {
  assertPermission(context, "research.write");
  const kind = RESEARCH_KINDS.find((value) => value === input.kind);
  const rows = await db.run((tx) =>
    tx.researchObservation.findMany({
      where: { ...(kind ? { kind } : {}), competitor: { archivedAt: null } },
      select: OBSERVATION_SELECT,
      orderBy: [{ observedOn: "desc" }, { createdAt: "desc" }],
      take: Math.min(input.limit ?? 50, 200),
    }),
  );
  return rows.map((row) => toObservation(row as ObservationRow));
}

/** Products an observation can be compared with. */
export async function productsForResearch(db: TenantDb, context: RequestContext) {
  assertPermission(context, "research.write");
  return db.run((tx) =>
    tx.product.findMany({
      where: { status: { in: ["active", "draft"] } },
      select: { id: true, name: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 300,
    }),
  );
}

// --- Ideas (AI) -------------------------------------------------------------------

export interface Idea {
  id: string;
  title: string;
  idea: string;
  score: number;
  rationale: string;
  status: IdeaStatus;
  origin: "ai_generated";
  model: string;
  createdAt: Date;
  /** The observations it cites that still exist. */
  cites: { id: string; title: string; competitor: string; observedOn: string }[];
}

/**
 * Drafts scored opportunity ideas from the latest observations (last 180
 * days, up to 60) and keeps them as suggestions to accept or dismiss.
 */
export async function draftResearchIdeas(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  input: { focus?: unknown } = {},
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  assertPermission(context, "research.write");
  assertPermission(context, "ai.use");
  const since = new Date(Date.now() - 180 * 86_400_000);
  const rows = await db.run((tx) =>
    tx.researchObservation.findMany({
      where: { observedOn: { gte: since }, competitor: { archivedAt: null } },
      select: OBSERVATION_SELECT,
      orderBy: [{ observedOn: "desc" }, { createdAt: "desc" }],
      take: 60,
    }),
  );
  if (rows.length === 0) {
    return { ok: false, message: "Add some observations first: ideas are drafted from them." };
  }
  const observations = rows.map((row) => toObservation(row as ObservationRow));
  const money = (amount: number | null, currency: string | null) =>
    amount !== null && currency ? formatMoney(amount, currency) : "";

  const products = await db.run((tx) =>
    tx.product.findMany({
      where: { status: "active" },
      select: {
        name: true,
        category: { select: { name: true } },
        variants: {
          where: { status: "active" },
          select: { priceAmount: true, discountPriceAmount: true, currency: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  );
  const items = products.map((product) => {
    const cheapest = product.variants
      .map((v) => ({ amount: v.discountPriceAmount ?? v.priceAmount, currency: v.currency }))
      .sort((a, b) => a.amount - b.amount)[0];
    return {
      name: product.name,
      facts: [
        ...(cheapest ? [`Price: from ${formatMoney(cheapest.amount, cheapest.currency)}`] : []),
        ...(product.category ? [`Category: ${product.category.name}`] : []),
      ],
    };
  });

  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { name: true, branding: true }, orderBy: { createdAt: "asc" } }),
  );
  const result = await gateway.run(
    "research.ideas",
    {
      language: "en",
      observations: observations.map((o) => ({
        id: o.id,
        competitor: o.competitor.name,
        kind: o.kind,
        title: o.title,
        detail: o.detail,
        price: money(o.priceAmount, o.currency),
        ours: o.ours
          ? `${o.ours.name}${o.ours.priceAmount !== null ? `, ${money(o.ours.priceAmount, o.ours.currency)}` : ""}`
          : "",
        observedOn: o.observedOn,
      })),
      items,
      focus: text(input.focus).slice(0, 500),
    },
    {
      tenantId: db.tenantId,
      profile: await getBusinessProfile(db),
      knowledge: createCommerceKnowledge(db, {
        name: store?.name ?? "Our store",
        branding: parseBranding(store?.branding ?? {}),
      }),
    },
  );
  if (!result.ok) return { ok: false, message: result.message };

  const event = await db.run((tx) =>
    tx.aiEvent.findUnique({ where: { id: result.eventId }, select: { model: true } }),
  );
  await db.run(async (tx) => {
    for (const entry of result.output.ideas) {
      const created = await tx.researchIdea.create({
        data: {
          tenantId: db.tenantId,
          title: entry.title,
          idea: entry.idea,
          score: entry.score,
          rationale: entry.rationale,
          observationIds: entry.observationIds,
          model: event?.model ?? "",
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await audit(tx, context, "research.idea_drafted", { type: "research_idea", id: created.id });
    }
  });
  return { ok: true, count: result.output.ideas.length };
}

export async function listIdeas(
  db: TenantDb,
  context: RequestContext,
  input: { status?: string } = {},
): Promise<Idea[]> {
  assertPermission(context, "research.write");
  const status = IDEA_STATUSES.find((value) => value === input.status) ?? "new";
  const rows = await db.run((tx) =>
    tx.researchIdea.findMany({
      where: { status },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
  );
  const ids = [...new Set(rows.flatMap((row) => row.observationIds))];
  const cited = await db.run((tx) =>
    tx.researchObservation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        observedOn: true,
        competitor: { select: { name: true } },
      },
    }),
  );
  const byId = new Map(cited.map((o) => [o.id, o]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    idea: row.idea,
    score: row.score,
    rationale: row.rationale,
    status: row.status as IdeaStatus,
    origin: "ai_generated",
    model: row.model,
    createdAt: row.createdAt,
    cites: row.observationIds.flatMap((id) => {
      const o = byId.get(id);
      return o
        ? [
            {
              id: o.id,
              title: o.title,
              competitor: o.competitor.name,
              observedOn: day(o.observedOn),
            },
          ]
        : [];
    }),
  }));
}

export async function decideIdea(
  db: TenantDb,
  context: RequestContext,
  id: string,
  decision: unknown,
): Promise<void> {
  assertPermission(context, "research.write");
  assertId(id, "idea");
  const status = decision === "accepted" || decision === "dismissed" ? decision : null;
  if (!status) throw new ResearchError("Choose to keep or dismiss the idea.");
  await db.run(async (tx) => {
    const updated = await tx.researchIdea.updateMany({
      where: { id },
      data: { status, decidedByUserId: context.userId, decidedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundError("idea");
    await audit(tx, context, "research.idea_decided", { type: "research_idea", id }, undefined, {
      status,
    });
  });
}
