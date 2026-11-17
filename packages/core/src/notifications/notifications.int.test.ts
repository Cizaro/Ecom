import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { addToCart } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import {
  cancelUnpaidOrder,
  expireUnpaidOrders,
  fulfilOrder,
  placeOrder,
  recordCashCollected,
} from "../orders/orders";
import { deliverPendingEmails, MAX_EMAIL_ATTEMPTS } from "./delivery";
import { createMemoryEmailProvider, type EmailMessage, type EmailProvider } from "./email";
import {
  getNotificationSettings,
  listUndeliveredEmails,
  retryEmail,
  saveNotificationSettings,
} from "./settings";

// Store emails against the real (test) database on the runtime connection,
// so Row-Level Security applies. Each store here is new, so its outbox holds
// only what these tests put there.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const SECRET = "k".repeat(40);
const OPTIONS = { appUrl: "http://localhost:3000", accessSecret: SECRET };

const beirut = {
  fullName: "Rami Haddad",
  phone: "+961 3 123 456",
  line1: "Hamra Street 5",
  city: "Beirut",
  country: "LB",
};

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Emails ${label} ${run}`, slug: `mail-${label}-${run}` },
  });
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" },
  });
  tenantIds.push(tenant.id);
  const shop = createTenantDb(app, { tenantId: tenant.id });
  const owner = await staff(tenant.id, "store_owner");
  return { tenantId: tenant.id, shop, owner };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `mail-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.62",
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

/** A product with one variant; stock counted when `stock` is given. */
async function variant(tenantId: string, opts: { stock?: number; low?: number } = {}) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: { tenantId, name: `Clutch ${tag}`, slug: `clutch-${tag}`, status: "active" },
  });
  const row = await admin.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      sku: `CL-${tag}`,
      color: "Red",
      priceAmount: 2000,
      currency: "USD",
      trackInventory: opts.stock !== undefined,
      lowStockThreshold: opts.low ?? null,
    },
  });
  if (opts.stock !== undefined) {
    const location = await admin.inventoryLocation.create({
      data: { tenantId, name: `Main ${tag}`, isDefault: true },
    });
    await admin.inventoryLevel.create({
      data: { tenantId, variantId: row.id, locationId: location.id, onHand: opts.stock },
    });
  }
  return row;
}

async function codOrder(shop: TenantDb, variantId: string, email = "rami@example.test") {
  const { token } = await addToCart(shop, null, { variantId, quantity: 1 });
  return placeOrder(shop, {
    owner: { token: token! },
    customer: null,
    email,
    address: beirut,
    paymentMethod: "cash_on_delivery",
    accessSecret: SECRET,
  });
}

const subjects = (sent: EmailMessage[]) => sent.map((m) => `${m.to} | ${m.subject}`);

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("order emails", () => {
  let s: Awaited<ReturnType<typeof store>>;
  beforeAll(async () => {
    s = await store("orders");
    await saveNotificationSettings(s.owner.db, s.owner.context, {
      orderEmails: "Orders@Shop.test",
      stockEmails: "",
    });
  });

  it("are sent once each, to the shopper and to staff, along the order's life", async () => {
    const item = await variant(s.tenantId);
    const placed = await codOrder(s.shop, item.id);
    const mail = createMemoryEmailProvider();

    expect(await deliverPendingEmails(s.shop, mail, OPTIONS)).toEqual({ sent: 2, failed: 0 });
    expect(subjects(mail.sent)).toEqual([
      `rami@example.test | Order #${placed.number} confirmed: Shop orders`,
      `orders@shop.test | New order #${placed.number}: $20.00, cash on delivery`,
    ]);
    // The guest's link opens their order.
    expect(mail.sent[0]!.text).toContain(`/order/${placed.orderId}?key=${placed.accessKey}`);
    // Nothing is sent twice.
    expect(await deliverPendingEmails(s.shop, mail, OPTIONS)).toEqual({ sent: 0, failed: 0 });

    await fulfilOrder(s.owner.db, s.owner.context, placed.orderId, {
      courier: "Toters",
      trackingReference: "TT-1",
    });
    await recordCashCollected(s.owner.db, s.owner.context, placed.orderId);
    await deliverPendingEmails(s.shop, mail, OPTIONS);
    expect(subjects(mail.sent).slice(2)).toEqual([
      `rami@example.test | Order #${placed.number} is on its way: Shop orders`,
      `rami@example.test | Payment received for order #${placed.number}: Shop orders`,
    ]);
    expect(mail.sent[2]!.text).toContain("Courier: Toters");
    expect(mail.sent[2]!.text).toContain("Tracking number: TT-1");
  });

  it("tell the shopper when an order is cancelled, by staff or for not paying in time", async () => {
    const item = await variant(s.tenantId);
    const byStaff = await codOrder(s.shop, item.id, "a@example.test");
    await cancelUnpaidOrder(s.owner.db, s.owner.context, byStaff.orderId);

    const { token } = await addToCart(s.shop, null, { variantId: item.id, quantity: 1 });
    const online = await placeOrder(s.shop, {
      owner: { token: token! },
      customer: null,
      email: "b@example.test",
      address: beirut,
      accessSecret: SECRET,
    });
    await expireUnpaidOrders(s.shop, new Date(Date.now() + 60 * 60_000));

    const mail = createMemoryEmailProvider();
    await deliverPendingEmails(s.shop, mail, OPTIONS);
    const cancelled = mail.sent.filter((m) => m.subject.includes("cancelled"));
    expect(cancelled.map((m) => m.to).sort()).toEqual(["a@example.test", "b@example.test"]);
    expect(cancelled.find((m) => m.to === "b@example.test")!.text).toContain(
      "not completed in time",
    );
    // An online order is not confirmed (and staff not told) until it is paid.
    expect(mail.sent.some((m) => m.subject.includes(`#${online.number} confirmed`))).toBe(false);
  });

  it("are retried after a failure, listed for staff, and can be tried again by hand", async () => {
    const item = await variant(s.tenantId);
    await codOrder(s.shop, item.id, "retry@example.test");
    const broken: EmailProvider = {
      async send() {
        throw new Error("SMTP connection refused");
      },
    };
    expect(await deliverPendingEmails(s.shop, broken, OPTIONS)).toEqual({ sent: 0, failed: 2 });
    // Not tried again straight away.
    const mail = createMemoryEmailProvider();
    expect(await deliverPendingEmails(s.shop, mail, OPTIONS)).toEqual({ sent: 0, failed: 0 });

    const waiting = await listUndeliveredEmails(s.owner.db, s.owner.context);
    expect(waiting).toHaveLength(2);
    expect(waiting[0]).toMatchObject({ attempts: 1, givenUp: false });
    expect(waiting[0]!.lastError).toContain("SMTP connection refused");

    for (const email of waiting) await retryEmail(s.owner.db, s.owner.context, email.id);
    expect(await deliverPendingEmails(s.shop, mail, OPTIONS)).toEqual({ sent: 2, failed: 0 });
    expect(await listUndeliveredEmails(s.owner.db, s.owner.context)).toEqual([]);
  });

  it("stop after the last attempt", async () => {
    const item = await variant(s.tenantId);
    await codOrder(s.shop, item.id, "never@example.test");
    // Pretend every attempt but one has already failed.
    await admin.outboxEvent.updateMany({
      where: { tenantId: s.tenantId, processedAt: null },
      data: { attempts: MAX_EMAIL_ATTEMPTS - 1 },
    });
    const broken: EmailProvider = {
      async send() {
        throw new Error("mailbox unavailable");
      },
    };
    await deliverPendingEmails(s.shop, broken, OPTIONS);
    await admin.outboxEvent.updateMany({
      where: { tenantId: s.tenantId, processedAt: null },
      data: { availableAt: new Date(0) },
    });
    const mail = createMemoryEmailProvider();
    expect(await deliverPendingEmails(s.shop, mail, OPTIONS)).toEqual({ sent: 0, failed: 0 });
    const listed = await listUndeliveredEmails(s.owner.db, s.owner.context);
    expect(listed.every((email) => email.givenUp)).toBe(true);
    // Clean up for the other tests in this store.
    for (const email of listed) await retryEmail(s.owner.db, s.owner.context, email.id);
    await deliverPendingEmails(s.shop, mail, OPTIONS);
  });

  it("are sent once even when two senders run at the same time", async () => {
    const item = await variant(s.tenantId);
    await codOrder(s.shop, item.id, "race@example.test");
    const first = createMemoryEmailProvider();
    const second = createMemoryEmailProvider();
    await Promise.all([
      deliverPendingEmails(s.shop, first, OPTIONS),
      deliverPendingEmails(s.shop, second, OPTIONS),
    ]);
    const all = [...first.sent, ...second.sent].filter((m) => m.to === "race@example.test");
    expect(all).toHaveLength(1);
  });
});

describe("low stock", () => {
  it("tells staff once when an order takes a product down to its level", async () => {
    const s = await store("stock");
    await saveNotificationSettings(s.owner.db, s.owner.context, {
      orderEmails: "",
      stockEmails: "stock@shop.test",
    });
    const item = await variant(s.tenantId, { stock: 4, low: 2 });
    await codOrder(s.shop, item.id); // 3 left: still fine
    await codOrder(s.shop, item.id); // 2 left: low
    await codOrder(s.shop, item.id); // 1 left: already low, no second email
    const mail = createMemoryEmailProvider();
    await deliverPendingEmails(s.shop, mail, OPTIONS);
    // No order addresses are set, so only the shoppers' confirmations and one stock email.
    const stock = mail.sent.filter((m) => m.to === "stock@shop.test");
    expect(stock).toHaveLength(1);
    const tag = item.sku.slice("CL-".length);
    expect(stock[0]!.subject).toBe(`Low stock: Clutch ${tag} (Red), ${item.sku}`);
    expect(stock[0]!.text).toContain("has 2 left to sell");
    expect(stock[0]!.text).toContain(`/admin/inventory/${item.id}`);
  });
});

describe("store separation", () => {
  it("keeps each store's emails and settings to itself", async () => {
    const a = await store("sep-a");
    const b = await store("sep-b");
    await saveNotificationSettings(a.owner.db, a.owner.context, {
      orderEmails: "owner-a@shop.test",
      stockEmails: "",
    });
    const item = await variant(a.tenantId);
    await codOrder(a.shop, item.id, "shopper-a@example.test");

    // Store B's sender sees none of store A's emails.
    const mailB = createMemoryEmailProvider();
    expect(await deliverPendingEmails(b.shop, mailB, OPTIONS)).toEqual({ sent: 0, failed: 0 });
    expect(await getNotificationSettings(b.owner.db, b.owner.context)).toEqual({
      orderEmails: [],
      stockEmails: [],
      supportEmails: [],
    });

    // Store B cannot see or retry store A's failed email.
    const broken: EmailProvider = {
      async send() {
        throw new Error("down");
      },
    };
    await deliverPendingEmails(a.shop, broken, OPTIONS);
    const failedA = await listUndeliveredEmails(a.owner.db, a.owner.context);
    expect(failedA.length).toBeGreaterThan(0);
    expect(await listUndeliveredEmails(b.owner.db, b.owner.context)).toEqual([]);
    await expect(retryEmail(b.owner.db, b.owner.context, failedA[0]!.id)).rejects.toThrow(
      NotFoundError,
    );

    // Store A's links point at store A.
    await admin.storeDomain.create({
      data: {
        tenantId: a.tenantId,
        storeId: (await admin.store.findFirstOrThrow({ where: { tenantId: a.tenantId } })).id,
        hostname: `shop-a-${run}.example.test`,
        isPrimary: true,
      },
    });
    for (const email of failedA) await retryEmail(a.owner.db, a.owner.context, email.id);
    const mailA = createMemoryEmailProvider();
    await deliverPendingEmails(a.shop, mailA, OPTIONS);
    const shopper = mailA.sent.find((m) => m.to === "shopper-a@example.test")!;
    expect(shopper.text).toContain(`http://shop-a-${run}.example.test:3000/order/`);
  });

  it("lets only staff with settings.write change who gets store emails", async () => {
    const s = await store("perm");
    const stock = await staff(s.tenantId, "inventory_manager");
    await expect(getNotificationSettings(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
    await expect(
      saveNotificationSettings(stock.db, stock.context, {
        orderEmails: "x@y.test",
        stockEmails: "",
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      saveNotificationSettings(s.owner.db, s.owner.context, {
        orderEmails: "not an email",
        stockEmails: "",
      }),
    ).rejects.toThrow(/not an email address/);
    const logged = await admin.auditLog.count({
      where: { tenantId: s.tenantId, action: "settings.notifications_updated" },
    });
    expect(logged).toBe(0);
  });
});
