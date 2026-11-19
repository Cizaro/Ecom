import type { AiGateway } from "@ecom/ai";
import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { getBusinessProfile } from "../ai/ai-admin";
import { createCommerceKnowledge } from "../ai/commerce-knowledge";
import { formatMoney } from "../catalog/money";
import { ASSET_SELECT, toStoredImage, type StoredImage } from "../media/assets";
import { safeTimeZone, zonedDateTime } from "../platform/time";
import { parseBranding } from "../tenancy/branding";
import { assertUuid, ContentError } from "./library";

// Content posts (Milestone 6.1, decision D105): a post planned for a social
// channel, its caption, the library files it uses and the products it
// features, through an approval workflow:
//
//   draft -> in_review -> approved -> published
//                  \-> changes_requested -> (edit) -> in_review
//
// content.write creates, edits and submits; content.approve approves or asks
// for changes; social.publish records that a post went out. Editing a post
// under review or approved sends it back to draft: what is approved is
// exactly what goes out. Nothing is posted to any platform automatically in
// this milestone.

export const POST_CHANNELS = ["instagram", "facebook", "tiktok", "whatsapp", "other"] as const;
export const POST_FORMATS = ["post", "reel", "story", "carousel"] as const;
export const POST_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "published",
] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];
export type PostFormat = (typeof POST_FORMATS)[number];
export type PostStatus = (typeof POST_STATUSES)[number];

const MAX_FILES = 10;
const MAX_PRODUCTS = 10;

export interface PostSummary {
  id: string;
  title: string;
  channel: PostChannel;
  format: PostFormat;
  status: PostStatus;
  plannedFor: Date | null;
  publishedAt: Date | null;
  cover: (StoredImage & { kind: "image" | "video" }) | null;
}

export interface PostView extends PostSummary {
  caption: string;
  reviewNote: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  publishedUrl: string | null;
  files: { id: string; title: string; kind: "image" | "video"; media: StoredImage }[];
  products: { id: string; name: string; slug: string }[];
  /** The marketing campaign it belongs to (D107). */
  campaign: { id: string; name: string } | null;
  /** Publishing through Meta (D114). */
  autoPublish: boolean;
  publishError: string | null;
  publishAttempts: number;
  publishing: boolean;
}

const COVER = {
  assets: {
    orderBy: { position: "asc" as const },
    take: 1,
    select: { asset: { select: { media: { select: { ...ASSET_SELECT, kind: true } } } } },
  },
};

type CoverRow = {
  assets: { asset: { media: Parameters<typeof toStoredImage>[0] & { kind: "image" | "video" } } }[];
};
const coverOf = (row: CoverRow) => {
  const media = row.assets[0]?.asset.media;
  return media ? { ...toStoredImage(media), kind: media.kind } : null;
};

async function timeZoneIn(db: TenantDb): Promise<string> {
  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { timezone: true }, orderBy: { createdAt: "asc" } }),
  );
  return safeTimeZone(store?.timezone);
}

interface PostInput {
  title: unknown;
  channel: unknown;
  format: unknown;
  caption?: unknown;
  /** Wall-clock time in the store's time zone ("2026-11-21T18:00"), or empty. */
  plannedFor?: unknown;
  fileIds?: unknown;
  productIds?: unknown;
  /** A marketing campaign of this store, or empty. */
  campaignId?: unknown;
}

async function cleanPost(db: TenantDb, input: PostInput) {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const title = text(input.title).replace(/\s+/g, " ").trim();
  if (!title) throw new ContentError("Give the post a name (for your team).", "title");
  if (title.length > 120)
    throw new ContentError("Shorten the name (120 characters at most).", "title");
  const channel = POST_CHANNELS.find((value) => value === input.channel);
  if (!channel) throw new ContentError("Choose where it will be posted.", "channel");
  const format = POST_FORMATS.find((value) => value === input.format);
  if (!format) throw new ContentError("Choose the kind of post.", "format");
  const caption = text(input.caption).replace(/\r\n?/g, "\n").trim();
  if (caption.length > 5000)
    throw new ContentError("Shorten the caption (5,000 characters at most).", "caption");
  const planned = text(input.plannedFor).trim();
  let plannedFor: Date | null = null;
  if (planned) {
    plannedFor = zonedDateTime(planned, await timeZoneIn(db));
    if (!plannedFor) throw new ContentError("Enter the planned date and time.", "plannedFor");
  }
  const ids = (value: unknown) => [
    ...new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    ),
  ];
  const fileIds = ids(input.fileIds);
  const productIds = ids(input.productIds);
  if (fileIds.length > MAX_FILES)
    throw new ContentError(`Use ${MAX_FILES} files at most.`, "fileIds");
  if (productIds.length > MAX_PRODUCTS) {
    throw new ContentError(`Feature ${MAX_PRODUCTS} products at most.`, "productIds");
  }
  for (const id of [...fileIds, ...productIds]) assertUuid(id, "file or product");
  const campaignId =
    typeof input.campaignId === "string" && input.campaignId ? input.campaignId : null;
  if (campaignId) assertUuid(campaignId, "campaign");
  return { title, channel, format, caption, plannedFor, fileIds, productIds, campaignId };
}

/** A campaign of this store (checked before writing, for a clear message). */
async function checkCampaign(tx: AppTransaction, campaignId: string | null) {
  if (!campaignId) return;
  const campaign = await tx.marketingCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true },
  });
  if (!campaign) throw new ContentError("That campaign no longer exists.", "campaignId");
}

/** Replaces a post's files and products; only ones of this store, and live files only. */
async function linkIn(
  tx: AppTransaction,
  tenantId: string,
  postId: string,
  fileIds: string[],
  productIds: string[],
) {
  const files = await tx.contentAsset.findMany({
    where: { id: { in: fileIds }, archivedAt: null },
    select: { id: true },
  });
  if (files.length !== fileIds.length)
    throw new ContentError("A chosen file is no longer in the library.", "fileIds");
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  if (products.length !== productIds.length)
    throw new ContentError("A chosen product no longer exists.", "productIds");
  await tx.contentPostAsset.deleteMany({ where: { postId } });
  await tx.contentPostProduct.deleteMany({ where: { postId } });
  if (fileIds.length > 0) {
    await tx.contentPostAsset.createMany({
      data: fileIds.map((assetId, position) => ({ tenantId, postId, assetId, position })),
    });
  }
  if (productIds.length > 0) {
    await tx.contentPostProduct.createMany({
      data: productIds.map((productId) => ({ tenantId, postId, productId })),
    });
  }
}

export async function createPost(
  db: TenantDb,
  context: RequestContext,
  input: PostInput,
): Promise<{ id: string }> {
  assertPermission(context, "content.write");
  const post = await cleanPost(db, input);
  return db.run(async (tx) => {
    await checkCampaign(tx, post.campaignId);
    const created = await tx.contentPost.create({
      data: {
        tenantId: db.tenantId,
        title: post.title,
        channel: post.channel,
        format: post.format,
        caption: post.caption,
        plannedFor: post.plannedFor,
        campaignId: post.campaignId,
        createdByUserId: context.userId,
      },
      select: { id: true },
    });
    await linkIn(tx, db.tenantId, created.id, post.fileIds, post.productIds);
    await audit(tx, context, "content.post_created", { type: "content_post", id: created.id });
    return created;
  });
}

/**
 * Edits a post. A post under review or approved goes back to draft (it must
 * be approved again as changed); a published post cannot be changed.
 */
export async function updatePost(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: PostInput,
): Promise<{ backToDraft: boolean }> {
  assertPermission(context, "content.write");
  assertUuid(id, "post");
  const post = await cleanPost(db, input);
  return db.run(async (tx) => {
    const before = await tx.contentPost.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new NotFoundError("post");
    await checkCampaign(tx, post.campaignId);
    if (before.status === "published")
      throw new ContentError("A published post cannot be changed.");
    const backToDraft = before.status === "in_review" || before.status === "approved";
    await tx.contentPost.update({
      where: { id },
      data: {
        title: post.title,
        channel: post.channel,
        format: post.format,
        caption: post.caption,
        plannedFor: post.plannedFor,
        campaignId: post.campaignId,
        // A changed post is approved (and scheduled) again before it goes out.
        autoPublish: false,
        ...(backToDraft
          ? { status: "draft", approvedByUserId: null, approvedAt: null, submittedAt: null }
          : {}),
      },
    });
    await linkIn(tx, db.tenantId, id, post.fileIds, post.productIds);
    await audit(
      tx,
      context,
      "content.post_updated",
      { type: "content_post", id },
      { status: before.status },
      {
        status: backToDraft ? "draft" : before.status,
      },
    );
    return { backToDraft };
  });
}

type Step = "submit" | "approve" | "request_changes" | "publish" | "unsubmit";

/** One step of the approval workflow; each needs its own permission and starting status. */
export async function movePost(
  db: TenantDb,
  context: RequestContext,
  id: string,
  step: Step,
  input: { note?: unknown; url?: unknown } = {},
): Promise<void> {
  assertUuid(id, "post");
  const rules: Record<
    Step,
    { permission: Parameters<typeof assertPermission>[1]; from: PostStatus[]; to: PostStatus }
  > = {
    submit: { permission: "content.write", from: ["draft", "changes_requested"], to: "in_review" },
    unsubmit: { permission: "content.write", from: ["in_review"], to: "draft" },
    approve: { permission: "content.approve", from: ["in_review"], to: "approved" },
    request_changes: {
      permission: "content.approve",
      from: ["in_review"],
      to: "changes_requested",
    },
    publish: { permission: "social.publish", from: ["approved"], to: "published" },
  };
  const rule = rules[step];
  assertPermission(context, rule.permission);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (step === "request_changes" && !note) {
    throw new ContentError("Say what should change.", "note");
  }
  if (note.length > 1000)
    throw new ContentError("Shorten the note (1,000 characters at most).", "note");
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (step === "publish" && url && !/^https:\/\/[^\s]+$/.test(url)) {
    throw new ContentError(
      "Enter the post's link as a full https:// address, or leave it empty.",
      "url",
    );
  }
  await db.run(async (tx) => {
    const post = await tx.contentPost.findUnique({
      where: { id },
      select: { status: true, caption: true },
    });
    if (!post) throw new NotFoundError("post");
    if (!rule.from.includes(post.status as PostStatus)) {
      throw new ContentError("This post has moved on meanwhile. Reload the page.");
    }
    if (step === "submit" && !post.caption.trim()) {
      throw new ContentError("Write the caption before sending it for approval.", "caption");
    }
    const now = new Date();
    await tx.contentPost.update({
      where: { id },
      data: {
        status: rule.to,
        ...(step === "submit" ? { submittedAt: now, reviewNote: null } : {}),
        ...(step === "unsubmit" ? { submittedAt: null } : {}),
        ...(step === "approve"
          ? { approvedByUserId: context.userId, approvedAt: now, reviewNote: note || null }
          : {}),
        ...(step === "request_changes" ? { reviewNote: note } : {}),
        ...(step === "publish"
          ? { publishedAt: now, publishedUrl: url || null, autoPublish: false }
          : {}),
      },
    });
    await audit(
      tx,
      context,
      `content.post_${step}`,
      { type: "content_post", id },
      { status: post.status },
      {
        status: rule.to,
      },
    );
  });
}

/** Removes a post that was never approved. */
export async function deletePost(db: TenantDb, context: RequestContext, id: string): Promise<void> {
  assertPermission(context, "content.write");
  assertUuid(id, "post");
  await db.run(async (tx) => {
    const post = await tx.contentPost.findUnique({ where: { id }, select: { status: true } });
    if (!post) throw new NotFoundError("post");
    if (post.status === "approved" || post.status === "published") {
      throw new ContentError("An approved or published post cannot be deleted.");
    }
    await tx.contentPost.delete({ where: { id } });
    await audit(tx, context, "content.post_deleted", { type: "content_post", id });
  });
}

const canSee = (context: RequestContext) => {
  if (
    !["content.write", "content.approve", "social.publish"].some((p) =>
      context.permissions.has(p as never),
    )
  ) {
    assertPermission(context, "content.write");
  }
};

export async function listPosts(
  db: TenantDb,
  context: RequestContext,
  input: { status?: string } = {},
): Promise<{ items: PostSummary[]; counts: Record<PostStatus, number> }> {
  canSee(context);
  const status = POST_STATUSES.find((value) => value === input.status);
  return db.run(async (tx) => {
    const groups = await tx.contentPost.groupBy({ by: ["status"], _count: { _all: true } });
    const counts = Object.fromEntries(POST_STATUSES.map((s) => [s, 0])) as Record<
      PostStatus,
      number
    >;
    for (const group of groups) counts[group.status as PostStatus] = group._count._all;
    const rows = await tx.contentPost.findMany({
      where: status ? { status } : {},
      select: {
        id: true,
        title: true,
        channel: true,
        format: true,
        status: true,
        plannedFor: true,
        publishedAt: true,
        ...COVER,
      },
      orderBy: [{ plannedFor: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    });
    return {
      counts,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        channel: row.channel as PostChannel,
        format: row.format as PostFormat,
        status: row.status as PostStatus,
        plannedFor: row.plannedFor,
        publishedAt: row.publishedAt,
        cover: coverOf(row as unknown as CoverRow),
      })),
    };
  });
}

export async function getPost(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<PostView> {
  canSee(context);
  assertUuid(id, "post");
  const row = await db.run((tx) =>
    tx.contentPost.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        channel: true,
        format: true,
        status: true,
        caption: true,
        plannedFor: true,
        reviewNote: true,
        submittedAt: true,
        approvedAt: true,
        approvedByUserId: true,
        publishedAt: true,
        publishedUrl: true,
        autoPublish: true,
        publishError: true,
        publishAttempts: true,
        publishingSince: true,
        assets: {
          orderBy: { position: "asc" },
          select: {
            asset: {
              select: { id: true, title: true, media: { select: { ...ASSET_SELECT, kind: true } } },
            },
          },
        },
        products: { select: { product: { select: { id: true, name: true, slug: true } } } },
        campaign: { select: { id: true, name: true } },
      },
    }),
  );
  if (!row) throw new NotFoundError("post");
  const approver = row.approvedByUserId
    ? await db.run((tx) =>
        tx.user.findUnique({
          where: { id: row.approvedByUserId! },
          select: { name: true, email: true },
        }),
      )
    : null;
  const files = row.assets.map(({ asset }) => ({
    id: asset.id,
    title: asset.title,
    kind: asset.media.kind,
    media: toStoredImage(asset.media),
  }));
  return {
    id: row.id,
    title: row.title,
    channel: row.channel as PostChannel,
    format: row.format as PostFormat,
    status: row.status as PostStatus,
    caption: row.caption,
    plannedFor: row.plannedFor,
    reviewNote: row.reviewNote,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    approvedBy: approver ? approver.name || approver.email : null,
    publishedAt: row.publishedAt,
    publishedUrl: row.publishedUrl,
    files,
    products: row.products.map(({ product }) => product),
    campaign: row.campaign,
    cover: files[0] ? { ...files[0].media, kind: files[0].kind } : null,
    autoPublish: row.autoPublish,
    publishError: row.publishError,
    publishAttempts: row.publishAttempts,
    publishing:
      row.publishingSince !== null && Date.now() - row.publishingSince.getTime() < 10 * 60_000,
  };
}

/** Posts planned in a month (YYYY-MM) of the store's calendar, and those not planned yet. */
export async function postCalendar(
  db: TenantDb,
  context: RequestContext,
  month: string,
): Promise<{ timeZone: string; planned: PostSummary[]; unplanned: number }> {
  canSee(context);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ContentError("Choose a month.");
  const timeZone = await timeZoneIn(db);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const next =
    monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  const from = zonedDateTime(`${month}-01T00:00`, timeZone)!;
  const to = zonedDateTime(`${next}-01T00:00`, timeZone)!;
  return db.run(async (tx) => {
    const rows = await tx.contentPost.findMany({
      where: { plannedFor: { gte: from, lt: to } },
      select: {
        id: true,
        title: true,
        channel: true,
        format: true,
        status: true,
        plannedFor: true,
        publishedAt: true,
        ...COVER,
      },
      orderBy: { plannedFor: "asc" },
      take: 500,
    });
    const unplanned = await tx.contentPost.count({
      where: { plannedFor: null, status: { not: "published" } },
    });
    return {
      timeZone,
      unplanned,
      planned: rows.map((row) => ({
        id: row.id,
        title: row.title,
        channel: row.channel as PostChannel,
        format: row.format as PostFormat,
        status: row.status as PostStatus,
        plannedFor: row.plannedFor,
        publishedAt: row.publishedAt,
        cover: coverOf(row as unknown as CoverRow),
      })),
    };
  });
}

/**
 * An AI draft of the caption from the featured products' own facts (price,
 * sale, colours, whether available; never stock counts). Returned for staff
 * to edit; nothing is saved here.
 */
export async function draftPostCaption(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  id: string,
  input: { language: unknown; brief?: unknown },
): Promise<{ ok: true; caption: string } | { ok: false; message: string }> {
  assertPermission(context, "content.write");
  assertPermission(context, "ai.use");
  assertUuid(id, "post");
  const language = input.language === "ar" ? "ar" : "en";
  const post = await db.run((tx) =>
    tx.contentPost.findUnique({
      where: { id },
      select: {
        channel: true,
        format: true,
        products: {
          select: {
            product: {
              select: {
                name: true,
                translations: { where: { locale: "ar" }, select: { name: true } },
                variants: {
                  where: { status: "active" },
                  select: {
                    priceAmount: true,
                    discountPriceAmount: true,
                    currency: true,
                    color: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  if (!post) throw new NotFoundError("post");
  if (post.products.length === 0) {
    return { ok: false, message: "Choose the products the post features first." };
  }
  const items = post.products.map(({ product }) => {
    const prices = product.variants.map((v) => ({
      now: v.discountPriceAmount ?? v.priceAmount,
      regular: v.priceAmount,
      currency: v.currency,
    }));
    const cheapest = prices.sort((a, b) => a.now - b.now)[0];
    const colours = [...new Set(product.variants.map((v) => v.color).filter(Boolean))];
    const arabicName = product.translations[0]?.name;
    return {
      name: language === "ar" && arabicName ? arabicName : product.name,
      facts: [
        ...(cheapest
          ? [
              `Price: ${prices.length > 1 ? "from " : ""}${formatMoney(cheapest.now, cheapest.currency)}`,
              ...(cheapest.now < cheapest.regular
                ? [`On sale; regular price ${formatMoney(cheapest.regular, cheapest.currency)}`]
                : []),
            ]
          : []),
        ...(colours.length > 0 ? [`Colours: ${colours.join(", ")}`] : []),
      ],
    };
  });
  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { name: true, branding: true }, orderBy: { createdAt: "asc" } }),
  );
  const result = await gateway.run(
    "post.caption",
    {
      language,
      channel: post.channel,
      format: post.format,
      items,
      brief: typeof input.brief === "string" ? input.brief.slice(0, 1000) : "",
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
  const hashtags = result.output.hashtags.join(" ");
  return {
    ok: true,
    caption: hashtags ? `${result.output.caption}\n\n${hashtags}` : result.output.caption,
  };
}

/** Products a post may feature (published ones first), for the post form. */
export async function productsForPosts(
  db: TenantDb,
  context: RequestContext,
  /** Products already on the post: always listed, so saving keeps them. */
  include: string[] = [],
): Promise<{ id: string; name: string; published: boolean }[]> {
  assertPermission(context, "content.write");
  const select = { id: true, name: true, status: true } as const;
  const [recent, linked] = await db.run(async (tx) => {
    // Newest first: what a post features is usually recent. One query at a time.
    const newest = await tx.product.findMany({
      where: { status: { in: ["active", "draft"] } },
      select,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 300,
    });
    const onPost = include.length
      ? await tx.product.findMany({ where: { id: { in: include } }, select })
      : [];
    return [newest, onPost] as const;
  });
  const rows = [...linked, ...recent.filter((row) => !linked.some((l) => l.id === row.id))];
  return rows.map((row) => ({ id: row.id, name: row.name, published: row.status === "active" }));
}
