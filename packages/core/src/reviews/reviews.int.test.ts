import { randomBytes, randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import {
  listProductReviews,
  listReviewsForModeration,
  moderateReview,
  replyToReview,
  reportReview,
  ReviewError,
  reviewEligibility,
  submitReview,
} from "./reviews";

// Reviews against the real (test) database on the runtime connection, so
// Row-Level Security and the database's own rules apply.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Reviews ${label} ${run}`, slug: `rev-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return {
    tenantId: tenant.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    owner: await staff(tenant.id, "store_owner"),
  };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `rev-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.66",
    userId: user.id,
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: null,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(
      SYSTEM_ROLES.find((r) => r.key === role)!.permissions as readonly PermissionKey[],
    ),
  };
  return { context, db: createTenantDb(app, context) };
}

async function product(tenantId: string) {
  const tag = randomUUID().slice(0, 8);
  const row = await admin.product.create({
    data: { tenantId, name: `Bag ${tag}`, slug: `bag-${tag}`, status: "active" },
  });
  const variant = await admin.productVariant.create({
    data: { tenantId, productId: row.id, sku: `B-${tag}`, priceAmount: 1000, currency: "USD" },
  });
  return { id: row.id, variantId: variant.id };
}

async function customer(tenantId: string, name = "Maya Khoury") {
  return admin.customer.create({
    data: { tenantId, email: `c-${randomUUID().slice(0, 8)}@example.test`, name },
  });
}

let orderNumber = 5000;
/** An order of this customer's with the product, in the given status. */
async function order(
  tenantId: string,
  customerId: string,
  variantId: string,
  status: "confirmed" | "fulfilled" = "fulfilled",
) {
  orderNumber += 1;
  const row = await admin.order.create({
    data: {
      tenantId,
      number: orderNumber,
      status: "confirmed",
      paymentMethod: "cash_on_delivery",
      customerId,
      email: "x@example.test",
      accessKeyHash: randomBytes(32).toString("hex"),
      currency: "USD",
      subtotalAmount: 1000,
      totalAmount: 1000,
      shippingAddress: { fullName: "Maya", line1: "x", city: "Beirut", country: "LB" },
      payBy: new Date(Date.now() + 86_400_000),
      items: {
        create: [
          {
            tenantId,
            variantId,
            productName: "Bag",
            sku: "B",
            quantity: 1,
            unitPriceAmount: 1000,
            lineTotalAmount: 1000,
          },
        ],
      },
    },
  });
  if (status === "fulfilled") {
    await admin.order.update({ where: { id: row.id }, data: { status: "fulfilled" } });
  }
  return row;
}

let s: Awaited<ReturnType<typeof store>>;

beforeAll(async () => {
  s = await store("main");
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("writing reviews", () => {
  it("is only for customers who received the product, once each", async () => {
    const item = await product(s.tenantId);
    const buyer = await customer(s.tenantId);
    const waiting = await customer(s.tenantId, "Rami Haddad");
    const stranger = await customer(s.tenantId, "Lea Hanna");
    await order(s.tenantId, buyer.id, item.variantId, "fulfilled");
    await order(s.tenantId, waiting.id, item.variantId, "confirmed"); // not sent yet

    expect(await reviewEligibility(s.shop, null, item.id)).toEqual({ state: "signed_out" });
    expect(await reviewEligibility(s.shop, stranger.id, item.id)).toEqual({ state: "not_bought" });
    expect(await reviewEligibility(s.shop, waiting.id, item.id)).toEqual({ state: "not_bought" });
    expect(await reviewEligibility(s.shop, buyer.id, item.id)).toEqual({ state: "can_review" });

    await expect(
      submitReview(s.shop, waiting, item.id, { rating: 5, body: "Lovely bag, really nice." }),
    ).rejects.toThrow(/once you have received it/);
    for (const bad of [
      { rating: 0, body: "Lovely bag, really nice." },
      { rating: 6, body: "Lovely bag, really nice." },
      { rating: 4, body: "Too short" },
    ]) {
      await expect(submitReview(s.shop, buyer, item.id, bad)).rejects.toThrow(ReviewError);
    }

    await submitReview(s.shop, buyer, item.id, {
      rating: 4,
      title: "Good size",
      body: "Fits a laptop and more.",
    });
    expect(await reviewEligibility(s.shop, buyer.id, item.id)).toEqual({
      state: "reviewed",
      status: "pending",
    });
    await expect(
      submitReview(s.shop, buyer, item.id, { rating: 5, body: "Second review attempt." }),
    ).rejects.toThrow("You have already reviewed this product.");

    // The database refuses a review without a qualifying order, whatever the code does.
    await expect(
      admin.productReview.create({
        data: {
          tenantId: s.tenantId,
          productId: item.id,
          customerId: stranger.id,
          rating: 5,
          body: "Made up review text.",
          authorName: "Fake",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("showing and moderating", () => {
  it("shows only approved reviews, with a summary from them, and staff replies", async () => {
    const item = await product(s.tenantId);
    const [a, b, c] = await Promise.all([
      customer(s.tenantId, "Nour Saad"),
      customer(s.tenantId, "Karim Aoun"),
      customer(s.tenantId, "Sara"),
    ]);
    for (const who of [a, b, c]) await order(s.tenantId, who.id, item.variantId);
    const first = await submitReview(s.shop, a, item.id, { rating: 5, body: "Perfect, love it." });
    const second = await submitReview(s.shop, b, item.id, {
      rating: 2,
      body: "Strap broke quickly.",
    });
    const third = await submitReview(s.shop, c, item.id, {
      rating: 3,
      body: "Okay for the price.",
    });

    expect((await listProductReviews(s.shop, item.id)).summary.count).toBe(0);
    await moderateReview(s.owner.db, s.owner.context, first.id, "approved");
    await moderateReview(s.owner.db, s.owner.context, second.id, "approved");
    await moderateReview(s.owner.db, s.owner.context, third.id, "rejected");
    await replyToReview(
      s.owner.db,
      s.owner.context,
      second.id,
      "Sorry! Message us for a free repair.",
    );

    const shown = await listProductReviews(s.shop, item.id);
    expect(shown.summary).toMatchObject({ count: 2, average: 3.5, stars: { 5: 1, 2: 1, 3: 0 } });
    expect(shown.reviews.map((r) => r.authorName).sort()).toEqual(["Karim A.", "Nour S."]);
    expect(shown.reviews.find((r) => r.id === second.id)!.reply).toBe(
      "Sorry! Message us for a free repair.",
    );
    // Hiding takes it off the page; the text is never changed by staff.
    await moderateReview(s.owner.db, s.owner.context, second.id, "hidden");
    expect((await listProductReviews(s.shop, item.id)).summary).toMatchObject({
      count: 1,
      average: 5,
    });
    const row = await admin.productReview.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.body).toBe("Strap broke quickly.");
    // Reviews cannot be deleted by the application.
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.productReview.deleteMany({ where: { id: second.id } }),
      ),
    ).rejects.toThrow();
    const logged = await admin.auditLog.count({
      where: { tenantId: s.tenantId, action: "reviews.moderated" },
    });
    expect(logged).toBe(4);
  });

  it("lets signed-in customers report a shown review once, and staff see the reports", async () => {
    const item = await product(s.tenantId);
    const author = await customer(s.tenantId, "Author Person");
    const reader = await customer(s.tenantId, "Reader Person");
    await order(s.tenantId, author.id, item.variantId);
    const review = await submitReview(s.shop, author, item.id, {
      rating: 1,
      body: "Buy from my shop instead!",
    });
    // A review not shown yet cannot be reported.
    await expect(reportReview(s.shop, reader.id, review.id, "spam")).rejects.toThrow(NotFoundError);
    await moderateReview(s.owner.db, s.owner.context, review.id, "approved");
    await reportReview(s.shop, reader.id, review.id, "spam");
    await reportReview(s.shop, reader.id, review.id, "spam"); // once only
    await expect(reportReview(s.shop, author.id, review.id, "spam")).rejects.toThrow(
      "You cannot report your own review.",
    );
    await expect(reportReview(s.shop, reader.id, review.id, "boring")).rejects.toThrow(ReviewError);

    const reported = await listReviewsForModeration(s.owner.db, s.owner.context, {
      status: "reported",
    });
    expect(reported.items).toEqual([
      expect.objectContaining({ id: review.id, reportCount: 1, reportReasons: ["spam"] }),
    ]);
  });

  it("stays inside each store and needs reviews.moderate", async () => {
    const other = await store("other");
    const item = await product(s.tenantId);
    const buyer = await customer(s.tenantId);
    await order(s.tenantId, buyer.id, item.variantId);
    const review = await submitReview(s.shop, buyer, item.id, {
      rating: 4,
      body: "Nice and sturdy bag.",
    });

    expect((await listReviewsForModeration(other.owner.db, other.owner.context)).items).toEqual([]);
    await expect(
      moderateReview(other.owner.db, other.owner.context, review.id, "approved"),
    ).rejects.toThrow(NotFoundError);
    await expect(
      listProductReviews(other.shop, item.id).then((r) => r.summary.count),
    ).resolves.toBe(0);
    // A customer of another store cannot review this store's product.
    const outsider = await customer(other.tenantId);
    await expect(
      submitReview(other.shop, outsider, item.id, { rating: 5, body: "Not even my store." }),
    ).rejects.toThrow(ReviewError);

    const stock = await staff(s.tenantId, "inventory_manager");
    if (!stock.context.permissions.has("reviews.moderate")) {
      await expect(listReviewsForModeration(stock.db, stock.context)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(moderateReview(stock.db, stock.context, review.id, "approved")).rejects.toThrow(
        ForbiddenError,
      );
    }
  });
});
