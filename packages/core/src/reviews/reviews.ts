import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { isUniqueViolation } from "../catalog/errors";

// Product reviews. Rules this file keeps:
//
// - Only a customer who bought the product and received it (an order of
//   theirs, sent, containing it) can review it, once. The database checks
//   this too. There is no way to add a review for someone else, and the
//   store cannot write reviews: no fake testimonials.
// - A review is shown only after staff approve it. Staff can reject or hide
//   it, and reply publicly; nothing is deleted, and staff cannot change what
//   the customer wrote.
// - Ratings and counts shown to shoppers come from approved reviews only.
// - Signed-in customers can report a review, once each.

export const REVIEW_STATUSES = ["pending", "approved", "rejected", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REPORT_REASONS = ["spam", "offensive", "not_about_product", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  spam: "Spam or advertising",
  offensive: "Offensive or abusive",
  not_about_product: "Not about this product",
  other: "Something else",
};

export const REVIEWS_PAGE_SIZE = 10;

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Maya Khoury" -> "Maya K.": enough to be personal, not a full name in public. */
export function authorNameFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Customer";
  const first = parts[0]!.slice(0, 40);
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]!.toUpperCase()}.` : "";
  return `${first}${last}`;
}

/** An order of this customer's, sent, with this product: the proof they bought it. */
async function qualifyingOrderIn(
  tx: AppTransaction,
  customerId: string,
  productId: string,
): Promise<string | null> {
  const order = await tx.order.findFirst({
    where: {
      customerId,
      status: { in: ["fulfilled", "refunded"] },
      items: { some: { variant: { productId } } },
    },
    select: { id: true },
    orderBy: { placedAt: "desc" },
  });
  return order?.id ?? null;
}

export type ReviewEligibility =
  | { state: "signed_out" }
  | { state: "not_bought" }
  | { state: "can_review" }
  | { state: "reviewed"; status: ReviewStatus };

/** Whether this shopper may review this product, for the product page. */
export async function reviewEligibility(
  db: TenantDb,
  customerId: string | null,
  productId: string,
): Promise<ReviewEligibility> {
  if (!customerId) return { state: "signed_out" };
  if (!UUID.test(productId)) return { state: "not_bought" };
  return db.run(async (tx) => {
    const existing = await tx.productReview.findFirst({
      where: { productId, customerId },
      select: { status: true },
    });
    if (existing) return { state: "reviewed", status: existing.status as ReviewStatus };
    return (await qualifyingOrderIn(tx, customerId, productId))
      ? { state: "can_review" }
      : { state: "not_bought" };
  });
}

/** A customer's review of a product they received. It waits for staff approval. */
export async function submitReview(
  db: TenantDb,
  customer: { id: string; name: string },
  productId: string,
  input: { rating: unknown; title?: unknown; body: unknown },
): Promise<{ id: string }> {
  if (!UUID.test(productId)) throw new NotFoundError("product");
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ReviewError("Choose a rating from 1 to 5 stars.", "rating");
  }
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().replace(/\s+/g, " ")
      : null;
  if (title && title.length > 120)
    throw new ReviewError("Shorten the title (120 characters at most).", "title");
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length < 10)
    throw new ReviewError("Write a few words about the product (10 characters at least).", "body");
  if (body.length > 2000)
    throw new ReviewError("Shorten your review (2,000 characters at most).", "body");
  try {
    return await db.run(async (tx) => {
      const orderId = await qualifyingOrderIn(tx, customer.id, productId);
      if (!orderId) {
        throw new ReviewError("You can review a product once you have received it from an order.");
      }
      return tx.productReview.create({
        data: {
          tenantId: db.tenantId,
          productId,
          customerId: customer.id,
          orderId,
          rating,
          title,
          body,
          authorName: authorNameFrom(customer.name),
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReviewError("You have already reviewed this product.");
    throw error;
  }
}

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  reply: string | null;
  createdAt: Date;
}

export interface RatingSummary {
  count: number;
  /** One decimal place, null without reviews. */
  average: number | null;
  /** How many reviews gave 5, 4, 3, 2 and 1 stars. */
  stars: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Approved reviews of a product, newest first, with its rating summary. */
export async function listProductReviews(
  db: TenantDb,
  productId: string,
  page = 1,
): Promise<{ summary: RatingSummary; reviews: PublicReview[]; pageCount: number }> {
  if (!UUID.test(productId)) throw new NotFoundError("product");
  const current = Number.isInteger(page) ? Math.min(Math.max(page, 1), 1000) : 1;
  return db.run(async (tx) => {
    const groups = await tx.productReview.groupBy({
      by: ["rating"],
      where: { productId, status: "approved" },
      _count: { _all: true },
    });
    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as RatingSummary["stars"];
    let count = 0;
    let total = 0;
    for (const group of groups) {
      stars[group.rating as 1 | 2 | 3 | 4 | 5] = group._count._all;
      count += group._count._all;
      total += group.rating * group._count._all;
    }
    const reviews = await tx.productReview.findMany({
      where: { productId, status: "approved" },
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        authorName: true,
        reply: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (current - 1) * REVIEWS_PAGE_SIZE,
      take: REVIEWS_PAGE_SIZE,
    });
    return {
      summary: { count, average: count ? Math.round((total / count) * 10) / 10 : null, stars },
      reviews,
      pageCount: Math.max(1, Math.ceil(count / REVIEWS_PAGE_SIZE)),
    };
  });
}

/** A signed-in customer reports an approved review, once. */
export async function reportReview(
  db: TenantDb,
  customerId: string,
  reviewId: string,
  reason: unknown,
): Promise<void> {
  if (!UUID.test(reviewId)) throw new NotFoundError("review");
  const why = REPORT_REASONS.find((value) => value === reason);
  if (!why) throw new ReviewError("Choose why you are reporting this review.", "reason");
  await db.run(async (tx) => {
    const review = await tx.productReview.findUnique({
      where: { id: reviewId },
      select: { status: true, customerId: true },
    });
    if (!review || review.status !== "approved") throw new NotFoundError("review");
    if (review.customerId === customerId)
      throw new ReviewError("You cannot report your own review.");
    await tx.reviewReport.createMany({
      data: [{ tenantId: db.tenantId, reviewId, customerId, reason: why }],
      skipDuplicates: true,
    });
  });
}

// --- Staff ---------------------------------------------------------------------

export interface ModerationReview extends PublicReview {
  status: ReviewStatus;
  productId: string;
  productName: string;
  reportCount: number;
  reportReasons: ReportReason[];
}

export async function listReviewsForModeration(
  db: TenantDb,
  context: RequestContext,
  input: { status?: ReviewStatus | "reported"; page?: number } = {},
): Promise<{ items: ModerationReview[]; total: number; pageCount: number; pending: number }> {
  assertPermission(context, "reviews.moderate");
  const page = Number.isInteger(input.page) ? Math.min(Math.max(input.page!, 1), 1000) : 1;
  const where =
    input.status === "reported"
      ? { reports: { some: {} } }
      : input.status && REVIEW_STATUSES.includes(input.status)
        ? { status: input.status }
        : {};
  return db.run(async (tx) => {
    const [total, pending, rows] = await Promise.all([
      tx.productReview.count({ where }),
      tx.productReview.count({ where: { status: "pending" } }),
      tx.productReview.findMany({
        where,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          authorName: true,
          reply: true,
          createdAt: true,
          status: true,
          productId: true,
          product: { select: { name: true } },
          reports: { select: { reason: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 25,
        take: 25,
      }),
    ]);
    return {
      total,
      pending,
      pageCount: Math.max(1, Math.ceil(total / 25)),
      items: rows.map(({ product, reports, ...row }) => ({
        ...row,
        status: row.status as ReviewStatus,
        productName: product.name,
        reportCount: reports.length,
        reportReasons: [...new Set(reports.map((r) => r.reason as ReportReason))],
      })),
    };
  });
}

/** Approves, rejects or hides a review. */
export async function moderateReview(
  db: TenantDb,
  context: RequestContext,
  reviewId: string,
  status: unknown,
): Promise<void> {
  assertPermission(context, "reviews.moderate");
  if (!UUID.test(reviewId)) throw new NotFoundError("review");
  const next = (["approved", "rejected", "hidden"] as const).find((value) => value === status);
  if (!next) throw new ReviewError("Choose what to do with the review.");
  await db.run(async (tx) => {
    const before = await tx.productReview.findUnique({
      where: { id: reviewId },
      select: { status: true },
    });
    if (!before) throw new NotFoundError("review");
    await tx.productReview.update({
      where: { id: reviewId },
      data: { status: next, moderatedAt: new Date(), moderatedBy: context.userId },
    });
    await audit(
      tx,
      context,
      "reviews.moderated",
      { type: "product_review", id: reviewId },
      { status: before.status },
      { status: next },
    );
  });
}

/** The store's public reply under a review. An empty reply removes it. */
export async function replyToReview(
  db: TenantDb,
  context: RequestContext,
  reviewId: string,
  reply: unknown,
): Promise<void> {
  assertPermission(context, "reviews.moderate");
  if (!UUID.test(reviewId)) throw new NotFoundError("review");
  const text = typeof reply === "string" ? reply.trim() : "";
  if (text.length > 2000)
    throw new ReviewError("Shorten the reply (2,000 characters at most).", "reply");
  await db.run(async (tx) => {
    const found = await tx.productReview.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });
    if (!found) throw new NotFoundError("review");
    await tx.productReview.update({
      where: { id: reviewId },
      data: { reply: text || null, repliedAt: text ? new Date() : null },
    });
    await audit(
      tx,
      context,
      "reviews.replied",
      { type: "product_review", id: reviewId },
      undefined,
      {
        reply: text ? "set" : "removed",
      },
    );
  });
}
