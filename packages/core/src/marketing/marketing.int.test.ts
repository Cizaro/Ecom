import { randomBytes, randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { createPost, getPost } from "../content/posts";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "./campaigns";
import { createLink, followLink, listLinks } from "./links";
import {
  deleteSegment,
  exportSegmentCsv,
  getSegment,
  saveSegment,
  segmentMembers,
} from "./segments";

// Campaigns, segments and tracking links against the real (test) database,
// on the runtime connection.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.98",
    userId,
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
}

let orderNumber = 7000;

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Marketing ${label} ${run}`, slug: `marketing-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  const shop = await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main", timezone: "Asia/Beirut" },
  });
  await admin.storeDomain.create({
    data: { tenantId: tenant.id, storeId: shop.id, hostname: `${label}-${run}.shop.test` },
  });
  const user = await admin.user.create({
    data: { email: `marketing-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const bags = await admin.category.create({
    data: { tenantId: tenant.id, name: "Bags", slug: "bags" },
  });
  const watches = await admin.category.create({
    data: { tenantId: tenant.id, name: "Watches", slug: "watches" },
  });
  const variant = async (categoryId: string, slug: string) => {
    const product = await admin.product.create({
      data: { tenantId: tenant.id, name: slug, slug, status: "active", categoryId },
    });
    const v = await admin.productVariant.create({
      data: {
        tenantId: tenant.id,
        productId: product.id,
        sku: `MK-${slug}-${label}-${run}`,
        priceAmount: 5000,
        currency: "USD",
      },
    });
    return { productId: product.id, variantId: v.id };
  };
  const bag = await variant(bags.id, "tote");
  const watch = await variant(watches.id, "watch");
  const as = (role: SystemRoleKey) => {
    const context = contextFor(tenant.id, user.id, role);
    return { context, db: createTenantDb(app, context) };
  };
  return { tenantId: tenant.id, host: `${label}-${run}.shop.test`, bags, bag, watch, as };
}

async function customer(tenantId: string, email: string, consent?: boolean) {
  const row = await admin.customer.create({
    data: { tenantId, email, name: email.split("@")[0]! },
  });
  if (consent !== undefined) {
    // An older opposite choice first: the latest one counts.
    await admin.consentRecord.create({
      data: {
        tenantId,
        subjectType: "customer",
        subjectId: row.id,
        purpose: "marketing_email",
        granted: !consent,
        source: "test",
        recordedAt: new Date(Date.now() - 60_000),
      },
    });
    await admin.consentRecord.create({
      data: {
        tenantId,
        subjectType: "customer",
        subjectId: row.id,
        purpose: "marketing_email",
        granted: consent,
        source: "test",
      },
    });
  }
  return row.id;
}

async function order(
  tenantId: string,
  customerId: string,
  variantId: string,
  total: number,
  input: { daysAgo?: number; code?: string; status?: "confirmed" | "cancelled" } = {},
) {
  orderNumber += 1;
  await admin.order.create({
    data: {
      tenantId,
      number: orderNumber,
      status: input.status ?? "confirmed",
      paymentMethod: "cash_on_delivery",
      customerId,
      email: "x@example.test",
      accessKeyHash: randomBytes(32).toString("hex"),
      currency: "USD",
      subtotalAmount: total,
      totalAmount: total,
      discountCode: input.code ?? null,
      shippingAddress: { fullName: "x", line1: "x", city: "Beirut", country: "LB" },
      payBy: new Date(Date.now() + 86_400_000),
      placedAt: new Date(Date.now() - (input.daysAgo ?? 0) * 86_400_000),
      items: {
        create: [
          {
            tenantId,
            variantId,
            productName: "x",
            sku: "x",
            quantity: 1,
            unitPriceAmount: total,
            lineTotalAmount: total,
          },
        ],
      },
    },
  });
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("campaigns", () => {
  it("keeps a brief, links posts and links, and counts clicks and code orders honestly", async () => {
    const s = await store("campaign");
    const { db, context } = s.as("marketer");
    const code = await admin.discountCode.create({
      data: { tenantId: s.tenantId, code: "SUMMER10", kind: "percent", value: 10, currency: "USD" },
    });
    const created = await createCampaign(db, context, {
      name: "Summer totes",
      objective: "sales",
      startsOn: daysFromNow(-3),
      endsOn: daysFromNow(10),
      channels: ["instagram", "tiktok"],
      audience: "Women 20 to 35 in Beirut",
      keyMessage: "Light totes for the beach",
      offer: "10% off with SUMMER10",
      budget: "150",
      discountCodeId: code.id,
      productIds: [s.bag.productId],
    });

    // Two orders with the code while it runs; one cancelled; one before it started.
    const buyer = await customer(s.tenantId, `buyer-${run}@example.test`);
    await order(s.tenantId, buyer, s.bag.variantId, 4500, { code: "SUMMER10" });
    await order(s.tenantId, buyer, s.bag.variantId, 9000, { code: "summer10", daysAgo: 1 });
    await order(s.tenantId, buyer, s.bag.variantId, 4500, {
      code: "SUMMER10",
      status: "cancelled",
    });
    await order(s.tenantId, buyer, s.bag.variantId, 4500, { code: "SUMMER10", daysAgo: 20 });

    const post = await createPost(db, context, {
      title: "Reel: tote on the beach",
      channel: "instagram",
      format: "reel",
      campaignId: created.id,
    });
    expect((await getPost(db, context, post.id)).campaign).toEqual({
      id: created.id,
      name: "Summer totes",
    });

    const link = await createLink(db, context, {
      label: "Reel link in bio",
      destination: `https://${s.host}/p/tote?utm_source=old`,
      source: "Instagram",
      medium: "bio",
      campaignId: created.id,
      postId: post.id,
    });
    // A visitor follows the short link twice (no user: the store's own handle).
    const shopDb = createTenantDb(app, { tenantId: s.tenantId });
    expect(await followLink(shopDb, link.shortCode)).toBe(
      `/p/tote?utm_source=instagram&utm_medium=bio&utm_campaign=summer-totes&utm_content=post-${post.id.slice(-8)}`,
    );
    await followLink(shopDb, link.shortCode.toUpperCase());
    expect(await followLink(shopDb, "nosuchcode")).toBeNull();

    const view = await getCampaign(db, context, created.id);
    expect(view).toMatchObject({
      name: "Summer totes",
      status: "planned",
      channels: ["instagram", "tiktok"],
      budgetAmount: 15000,
      discountCode: { code: "SUMMER10" },
      products: [{ id: s.bag.productId, name: "tote" }],
      posts: [{ id: post.id, title: "Reel: tote on the beach" }],
      clicks: 2,
      codeOrders: { count: 2, revenueAmount: 13500 },
    });
    expect((await listLinks(db, context, { postId: post.id }))[0]).toMatchObject({
      clickCount: 2,
      destinationPath: "/p/tote",
    });
    // The content editor sees a post's links but cannot make one.
    const editor = s.as("content_editor");
    expect(await listLinks(editor.db, editor.context, { postId: post.id })).toHaveLength(1);
    await expect(
      createLink(editor.db, editor.context, {
        label: "x",
        destination: "/",
        source: "x",
        medium: "x",
      }),
    ).rejects.toThrow(ForbiddenError);

    // Links never lead off the store.
    await expect(
      createLink(db, context, {
        label: "Elsewhere",
        destination: "https://evil.example/x",
        source: "ig",
        medium: "bio",
      }),
    ).rejects.toThrow(/own shop/);

    await updateCampaign(db, context, created.id, {
      name: "Summer totes",
      objective: "sales",
      status: "active",
      startsOn: daysFromNow(-3),
      endsOn: "",
    });
    expect((await listCampaigns(db, context, { status: "active" })).map((c) => c.id)).toEqual([
      created.id,
    ]);
    await expect(
      updateCampaign(db, context, created.id, {
        name: "x",
        objective: "sales",
        startsOn: today(),
        endsOn: daysFromNow(-1),
      }),
    ).rejects.toThrow(/before the start/);

    // Deleting keeps the post and the link, unlinked.
    await deleteCampaign(db, context, created.id);
    expect((await getPost(db, context, post.id)).campaign).toBeNull();
    expect(await listLinks(db, context, { postId: post.id })).toHaveLength(1);
  });

  it("needs marketing.write and stays inside its store", async () => {
    const a = await store("campaign-a");
    const b = await store("campaign-b");
    const owner = a.as("store_owner");
    const created = await createCampaign(owner.db, owner.context, {
      name: "A only",
      objective: "awareness",
      startsOn: today(),
    });
    const editor = a.as("content_editor");
    await expect(listCampaigns(editor.db, editor.context)).rejects.toThrow(ForbiddenError);
    const other = b.as("store_owner");
    await expect(getCampaign(other.db, other.context, created.id)).rejects.toThrow(/not found/i);
    // Another store's product, code or campaign cannot be linked.
    await expect(
      createCampaign(other.db, other.context, {
        name: "B",
        objective: "sales",
        startsOn: today(),
        productIds: [a.bag.productId],
      }),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      createPost(other.db, other.context, {
        title: "x",
        channel: "instagram",
        format: "post",
        campaignId: created.id,
      }),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe("segments", () => {
  it("matches customers by their orders and exports only those who agreed to emails", async () => {
    const s = await store("segment");
    const marketer = s.as("marketer");
    const loyal = await customer(s.tenantId, `loyal-${run}@example.test`, true);
    const lapsed = await customer(s.tenantId, `lapsed-${run}@example.test`, false);
    const watcher = await customer(s.tenantId, `watcher-${run}@example.test`, true);
    await customer(s.tenantId, `never-${run}@example.test`);
    await order(s.tenantId, loyal, s.bag.variantId, 6000, { daysAgo: 5 });
    await order(s.tenantId, loyal, s.bag.variantId, 6000, { daysAgo: 2 });
    await order(s.tenantId, lapsed, s.bag.variantId, 20000, { daysAgo: 200 });
    await order(s.tenantId, watcher, s.watch.variantId, 3000, { daysAgo: 1 });
    await order(s.tenantId, watcher, s.watch.variantId, 9000, { status: "cancelled" });

    const repeat = await saveSegment(marketer.db, marketer.context, null, {
      name: "Repeat buyers",
      minOrders: "2",
    });
    expect(await getSegment(marketer.db, marketer.context, repeat.id)).toMatchObject({
      count: 1,
      withConsent: 1,
      rules: { minOrders: 2 },
    });

    const bigSpenders = await saveSegment(marketer.db, marketer.context, null, {
      name: "Spent 100 or more",
      minSpent: "100",
    });
    const members = await segmentMembers(marketer.db, marketer.context, bigSpenders.id);
    expect(members.map((m) => [m.email, m.spentAmount, m.marketingConsent])).toEqual([
      [`lapsed-${run}@example.test`, 20000, false],
      [`loyal-${run}@example.test`, 12000, true],
    ]);

    const winBack = await saveSegment(marketer.db, marketer.context, null, {
      name: "Win back",
      noOrderForDays: "90",
    });
    expect((await getSegment(marketer.db, marketer.context, winBack.id)).count).toBe(1);
    const bagBuyers = await saveSegment(marketer.db, marketer.context, null, {
      name: "Bag buyers, recent",
      categoryId: s.bags.id,
      orderedWithinDays: "30",
    });
    expect((await getSegment(marketer.db, marketer.context, bagBuyers.id)).count).toBe(1);
    const everyone = await saveSegment(marketer.db, marketer.context, null, { name: "Everyone" });
    expect(await getSegment(marketer.db, marketer.context, everyone.id)).toMatchObject({
      count: 4,
      withConsent: 2,
    });

    await expect(
      saveSegment(marketer.db, marketer.context, null, { name: "Everyone" }),
    ).rejects.toThrow(/exists/);
    await expect(
      saveSegment(marketer.db, marketer.context, null, {
        name: "Impossible",
        orderedWithinDays: "30",
        noOrderForDays: "60",
      }),
    ).rejects.toThrow(/Change one/);

    // The marketer cannot export; the owner can, and gets only consenting customers.
    await expect(exportSegmentCsv(marketer.db, marketer.context, everyone.id)).rejects.toThrow(
      ForbiddenError,
    );
    const owner = s.as("store_owner");
    const csv = await exportSegmentCsv(owner.db, owner.context, everyone.id);
    expect(csv.count).toBe(2);
    expect(csv.csv).toContain(`loyal-${run}@example.test`);
    expect(csv.csv).toContain(`watcher-${run}@example.test`);
    expect(csv.csv).not.toContain("lapsed-");
    expect(csv.csv).not.toContain("never-");
    expect(csv.filename).toBe("segment-everyone.csv");
    const allAgreed = await exportSegmentCsv(owner.db, owner.context, null);
    expect([allAgreed.count, allAgreed.filename]).toEqual([2, "segment-all-who-agreed.csv"]);
    const exported = await admin.auditLog.count({
      where: { tenantId: s.tenantId, action: "marketing.segment_exported" },
    });
    expect(exported).toBe(2);

    // Members need customers.read: the content editor has no marketing access at all.
    const editor = s.as("content_editor");
    await expect(segmentMembers(editor.db, editor.context, everyone.id)).rejects.toThrow(
      ForbiddenError,
    );
    await deleteSegment(owner.db, owner.context, everyone.id);
    await expect(getSegment(owner.db, owner.context, everyone.id)).rejects.toThrow(/not found/i);
  });
});
