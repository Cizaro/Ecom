import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { parseMoney } from "../catalog/money";

// Marketing campaigns and their briefs (Milestone 7.1, decision D107). This is
// planning: a campaign never spends money and never posts anywhere. Its
// results are counted honestly from the store's own data: clicks on its
// tracking links, and orders that used its discount code while it ran.

export const CAMPAIGN_OBJECTIVES = ["awareness", "traffic", "sales", "launch", "loyalty"] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];
export const CAMPAIGN_STATUSES = ["planned", "active", "finished", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_CHANNELS = [
  "instagram",
  "facebook",
  "tiktok",
  "whatsapp",
  "email",
  "in_store",
  "other",
] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export class MarketingError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "MarketingError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const assertMarketingId = (id: string, what: string) => {
  if (!UUID.test(id)) throw new NotFoundError(what);
};

/** Orders that count as sales: placed and not cancelled or still unpaid. */
export const COUNTED_ORDER_STATUSES = ["confirmed", "paid", "fulfilled", "refunded"] as const;

export interface CampaignInput {
  name: unknown;
  objective: unknown;
  status?: unknown;
  startsOn: unknown;
  endsOn?: unknown;
  channels?: unknown;
  audience?: unknown;
  keyMessage?: unknown;
  offer?: unknown;
  budget?: unknown;
  discountCodeId?: unknown;
  segmentId?: unknown;
  notes?: unknown;
  productIds?: unknown;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toDay = (value: unknown): Date | null => {
  if (typeof value !== "string" || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
export const dayString = (date: Date) => date.toISOString().slice(0, 10);

async function storeCurrency(db: TenantDb): Promise<string> {
  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
  );
  return store?.defaultCurrency ?? "USD";
}

async function cleanCampaign(db: TenantDb, input: CampaignInput) {
  const text = (value: unknown, max: number, field: string, what: string) => {
    const result = (typeof value === "string" ? value : "").replace(/\r\n?/g, "\n").trim();
    if (result.length > max) {
      throw new MarketingError(
        `Shorten the ${what} (${max.toLocaleString("en")} characters at most).`,
        field,
      );
    }
    return result;
  };
  const name = text(input.name, 120, "name", "name").replace(/\s+/g, " ");
  if (!name) throw new MarketingError("Give the campaign a name.", "name");
  const objective = CAMPAIGN_OBJECTIVES.find((value) => value === input.objective);
  if (!objective) throw new MarketingError("Choose what the campaign is for.", "objective");
  const status = input.status
    ? CAMPAIGN_STATUSES.find((value) => value === input.status)
    : "planned";
  if (!status) throw new MarketingError("Choose a status.", "status");
  const startsOn = toDay(input.startsOn);
  if (!startsOn) throw new MarketingError("Enter the start date.", "startsOn");
  let endsOn: Date | null = null;
  if (typeof input.endsOn === "string" && input.endsOn.trim()) {
    endsOn = toDay(input.endsOn.trim());
    if (!endsOn) throw new MarketingError("Enter a valid end date.", "endsOn");
    if (endsOn < startsOn)
      throw new MarketingError("The end date is before the start date.", "endsOn");
  }
  const list = (value: unknown) =>
    [...new Set(Array.isArray(value) ? value : typeof value === "string" ? [value] : [])].filter(
      (item): item is string => typeof item === "string" && item !== "",
    );
  const channels = list(input.channels);
  if (channels.some((c) => !(CAMPAIGN_CHANNELS as readonly string[]).includes(c))) {
    throw new MarketingError("Choose channels from the list.", "channels");
  }
  const currency = await storeCurrency(db);
  const budgetText = typeof input.budget === "string" ? input.budget.trim() : "";
  let budgetAmount: number | null = null;
  if (budgetText) {
    budgetAmount = parseMoney(budgetText, currency);
    if (budgetAmount === null)
      throw new MarketingError("Enter the budget as an amount, like 150.", "budget");
  }
  const optionalId = (value: unknown, what: string) => {
    if (typeof value !== "string" || value === "") return null;
    assertMarketingId(value, what);
    return value;
  };
  const productIds = list(input.productIds);
  if (productIds.length > 50) throw new MarketingError("Choose 50 products at most.", "productIds");
  for (const id of productIds) assertMarketingId(id, "product");
  return {
    name,
    objective,
    status,
    startsOn,
    endsOn,
    channels,
    audience: text(input.audience, 1000, "audience", "audience"),
    keyMessage: text(input.keyMessage, 1000, "keyMessage", "key message"),
    offer: text(input.offer, 500, "offer", "offer"),
    budgetAmount,
    currency,
    discountCodeId: optionalId(input.discountCodeId, "discount code"),
    segmentId: optionalId(input.segmentId, "segment"),
    notes: text(input.notes, 2000, "notes", "notes"),
    productIds,
  };
}

type Clean = Awaited<ReturnType<typeof cleanCampaign>>;
type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

async function checkLinks(tx: Tx, campaign: Clean) {
  if (campaign.discountCodeId) {
    const code = await tx.discountCode.findUnique({
      where: { id: campaign.discountCodeId },
      select: { id: true },
    });
    if (!code) throw new MarketingError("That discount code no longer exists.", "discountCodeId");
  }
  if (campaign.segmentId) {
    const segment = await tx.customerSegment.findUnique({
      where: { id: campaign.segmentId },
      select: { id: true },
    });
    if (!segment) throw new MarketingError("That segment no longer exists.", "segmentId");
  }
  const products = await tx.product.count({ where: { id: { in: campaign.productIds } } });
  if (products !== campaign.productIds.length) {
    throw new MarketingError("A chosen product no longer exists.", "productIds");
  }
}

const fields = (campaign: Clean) => ({
  name: campaign.name,
  objective: campaign.objective,
  status: campaign.status,
  startsOn: campaign.startsOn,
  endsOn: campaign.endsOn,
  channels: campaign.channels,
  audience: campaign.audience,
  keyMessage: campaign.keyMessage,
  offer: campaign.offer,
  budgetAmount: campaign.budgetAmount,
  currency: campaign.currency,
  discountCodeId: campaign.discountCodeId,
  segmentId: campaign.segmentId,
  notes: campaign.notes,
});

export async function createCampaign(
  db: TenantDb,
  context: RequestContext,
  input: CampaignInput,
): Promise<{ id: string }> {
  assertPermission(context, "marketing.write");
  const campaign = await cleanCampaign(db, input);
  return db.run(async (tx) => {
    await checkLinks(tx, campaign);
    const created = await tx.marketingCampaign.create({
      data: { tenantId: db.tenantId, ...fields(campaign), createdByUserId: context.userId },
      select: { id: true },
    });
    if (campaign.productIds.length) {
      await tx.marketingCampaignProduct.createMany({
        data: campaign.productIds.map((productId) => ({
          tenantId: db.tenantId,
          campaignId: created.id,
          productId,
        })),
      });
    }
    await audit(tx, context, "marketing.campaign_created", {
      type: "marketing_campaign",
      id: created.id,
    });
    return created;
  });
}

export async function updateCampaign(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: CampaignInput,
): Promise<void> {
  assertPermission(context, "marketing.write");
  assertMarketingId(id, "campaign");
  const campaign = await cleanCampaign(db, input);
  await db.run(async (tx) => {
    const before = await tx.marketingCampaign.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!before) throw new NotFoundError("campaign");
    await checkLinks(tx, campaign);
    await tx.marketingCampaign.update({ where: { id }, data: fields(campaign) });
    await tx.marketingCampaignProduct.deleteMany({ where: { campaignId: id } });
    if (campaign.productIds.length) {
      await tx.marketingCampaignProduct.createMany({
        data: campaign.productIds.map((productId) => ({
          tenantId: db.tenantId,
          campaignId: id,
          productId,
        })),
      });
    }
    await audit(
      tx,
      context,
      "marketing.campaign_updated",
      { type: "marketing_campaign", id },
      { status: before.status },
      { status: campaign.status },
    );
  });
}

/** Deletes a campaign; its posts and links stay, no longer linked to it. */
export async function deleteCampaign(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<void> {
  assertPermission(context, "marketing.write");
  assertMarketingId(id, "campaign");
  await db.run(async (tx) => {
    const deleted = await tx.marketingCampaign.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new NotFoundError("campaign");
    await audit(tx, context, "marketing.campaign_deleted", { type: "marketing_campaign", id });
  });
}

export interface CampaignSummary {
  id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  startsOn: string;
  endsOn: string | null;
  channels: CampaignChannel[];
  budgetAmount: number | null;
  currency: string;
  postCount: number;
  clicks: number;
}

/** Campaigns, by start date; optionally only one status, or those overlapping a year. */
export async function listCampaigns(
  db: TenantDb,
  context: RequestContext,
  input: { status?: string; year?: number } = {},
): Promise<CampaignSummary[]> {
  assertPermission(context, "marketing.write");
  const status = CAMPAIGN_STATUSES.find((value) => value === input.status);
  const year = input.year && input.year > 2000 && input.year < 3000 ? input.year : null;
  const rows = await db.run((tx) =>
    tx.marketingCampaign.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(year
          ? {
              startsOn: { lte: new Date(Date.UTC(year, 11, 31)) },
              OR: [{ endsOn: null }, { endsOn: { gte: new Date(Date.UTC(year, 0, 1)) } }],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        objective: true,
        status: true,
        startsOn: true,
        endsOn: true,
        channels: true,
        budgetAmount: true,
        currency: true,
        _count: { select: { posts: true } },
        links: { select: { clickCount: true } },
      },
      orderBy: [{ startsOn: "asc" }, { name: "asc" }],
      take: 500,
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    objective: row.objective as CampaignObjective,
    status: row.status as CampaignStatus,
    startsOn: dayString(row.startsOn),
    endsOn: row.endsOn ? dayString(row.endsOn) : null,
    channels: row.channels as CampaignChannel[],
    budgetAmount: row.budgetAmount,
    currency: row.currency,
    postCount: row._count.posts,
    clicks: row.links.reduce((sum, link) => sum + link.clickCount, 0),
  }));
}

export interface CampaignView extends CampaignSummary {
  audience: string;
  keyMessage: string;
  offer: string;
  notes: string;
  discountCode: { id: string; code: string } | null;
  segment: { id: string; name: string } | null;
  products: { id: string; name: string }[];
  posts: { id: string; title: string; status: string; plannedFor: Date | null }[];
  /** Orders that used the campaign's discount code between its start and end. */
  codeOrders: { count: number; revenueAmount: number } | null;
}

export async function getCampaign(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<CampaignView> {
  assertPermission(context, "marketing.write");
  assertMarketingId(id, "campaign");
  const row = await db.run((tx) =>
    tx.marketingCampaign.findUnique({
      where: { id },
      include: {
        discountCode: { select: { id: true, code: true } },
        segment: { select: { id: true, name: true } },
        products: { select: { product: { select: { id: true, name: true } } } },
        posts: {
          select: { id: true, title: true, status: true, plannedFor: true },
          orderBy: [{ plannedFor: "asc" }, { createdAt: "asc" }],
        },
        links: { select: { clickCount: true } },
      },
    }),
  );
  if (!row) throw new NotFoundError("campaign");

  let codeOrders: CampaignView["codeOrders"] = null;
  if (row.discountCode) {
    const until = row.endsOn ? new Date(row.endsOn.getTime() + 86_400_000) : undefined;
    const orders = await db.run((tx) =>
      tx.order.aggregate({
        where: {
          discountCode: { equals: row.discountCode!.code, mode: "insensitive" },
          status: { in: [...COUNTED_ORDER_STATUSES] },
          placedAt: { gte: row.startsOn, ...(until ? { lt: until } : {}) },
        },
        _count: { _all: true },
        _sum: { totalAmount: true, refundedAmount: true },
      }),
    );
    codeOrders = {
      count: orders._count._all,
      revenueAmount: (orders._sum.totalAmount ?? 0) - (orders._sum.refundedAmount ?? 0),
    };
  }

  return {
    id: row.id,
    name: row.name,
    objective: row.objective as CampaignObjective,
    status: row.status as CampaignStatus,
    startsOn: dayString(row.startsOn),
    endsOn: row.endsOn ? dayString(row.endsOn) : null,
    channels: row.channels as CampaignChannel[],
    budgetAmount: row.budgetAmount,
    currency: row.currency,
    postCount: row.posts.length,
    clicks: row.links.reduce((sum, link) => sum + link.clickCount, 0),
    audience: row.audience,
    keyMessage: row.keyMessage,
    offer: row.offer,
    notes: row.notes,
    discountCode: row.discountCode,
    segment: row.segment,
    products: row.products.map((p) => p.product),
    posts: row.posts,
    codeOrders,
  };
}

/** What the campaign form can link to: discount codes, segments, products. */
export async function campaignChoices(db: TenantDb, context: RequestContext) {
  assertPermission(context, "marketing.write");
  return db.run(async (tx) => {
    // One query at a time: a transaction runs its queries in turn.
    const codes = await tx.discountCode.findMany({
      select: { id: true, code: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const segments = await tx.customerSegment.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    const products = await tx.product.findMany({
      where: { status: { in: ["active", "draft"] } },
      select: { id: true, name: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 300,
    });
    return { codes, segments, products };
  });
}

/**
 * Campaigns a post can belong to: planned and active ones, plus the post's
 * current one. Needs only content.write (the post form shows it).
 */
export async function campaignsForPosts(
  db: TenantDb,
  context: RequestContext,
  current: string | null = null,
): Promise<{ id: string; name: string }[]> {
  assertPermission(context, "content.write");
  return db.run((tx) =>
    tx.marketingCampaign.findMany({
      where: {
        OR: [{ status: { in: ["planned", "active"] } }, ...(current ? [{ id: current }] : [])],
      },
      select: { id: true, name: true },
      orderBy: [{ startsOn: "desc" }, { name: "asc" }],
      take: 200,
    }),
  );
}

/** The store's own address for links: its primary domain, with the app's scheme and port. */
export async function shopHost(db: TenantDb): Promise<string | null> {
  const domain = await db.run((tx) =>
    tx.storeDomain.findFirst({
      select: { hostname: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  );
  return domain?.hostname ?? null;
}
