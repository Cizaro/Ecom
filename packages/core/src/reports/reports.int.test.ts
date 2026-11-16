import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { addToCart } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { deliverPendingEmails } from "../notifications/delivery";
import { createMemoryEmailProvider } from "../notifications/email";
import {
  cancelUnpaidOrder,
  fulfilOrder,
  getOrderForStaff,
  listOrders,
  OrderError,
  placeOrder,
  recordCashCollected,
} from "../orders/orders";
import { recordReturn } from "../orders/returns";
import { addDays, zonedDay } from "../platform/time";
import { exportOrdersCsv, getDashboard } from "./reports";

// Returns, refunds, the dashboard and the orders export against the real
// (test) database on the runtime connection, so Row-Level Security and the
// database's own rules apply. Each store is new, so its figures are exact.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const SECRET = "k".repeat(40);

const beirut = {
  fullName: "Rami Haddad",
  phone: "+961 3 123 456",
  line1: "Hamra Street 5",
  city: "Beirut",
  country: "LB",
};

async function store(label: string, timezone = "Asia/Beirut") {
  const tenant = await admin.tenant.create({
    data: { name: `Reports ${label} ${run}`, slug: `rep-${label}-${run}` },
  });
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main", timezone },
  });
  tenantIds.push(tenant.id);
  return {
    tenantId: tenant.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    owner: await staff(tenant.id, "store_owner"),
  };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `rep-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.63",
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

async function variant(tenantId: string, price: number, stock?: number) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: { tenantId, name: `Belt ${tag}`, slug: `belt-${tag}`, status: "active" },
  });
  const row = await admin.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      sku: `BT-${tag}`,
      priceAmount: price,
      currency: "USD",
      trackInventory: stock !== undefined,
    },
  });
  if (stock !== undefined) {
    const location =
      (await admin.inventoryLocation.findFirst({ where: { tenantId, isDefault: true } })) ??
      (await admin.inventoryLocation.create({
        data: { tenantId, name: "Main location", isDefault: true },
      }));
    await admin.inventoryLevel.create({
      data: { tenantId, variantId: row.id, locationId: location.id, onHand: stock },
    });
  }
  return row;
}

async function order(
  shop: TenantDb,
  variantId: string,
  opts: { quantity?: number; online?: boolean; email?: string } = {},
) {
  const { token } = await addToCart(shop, null, { variantId, quantity: opts.quantity ?? 1 });
  return placeOrder(shop, {
    owner: { token: token! },
    customer: null,
    email: opts.email ?? "rami@example.test",
    address: beirut,
    paymentMethod: opts.online ? "online" : "cash_on_delivery",
    accessSecret: SECRET,
  });
}

/** A cash order sent and paid, ready for returns. */
async function deliveredOrder(
  s: Awaited<ReturnType<typeof store>>,
  variantId: string,
  quantity = 2,
) {
  const placed = await order(s.shop, variantId, { quantity });
  await fulfilOrder(s.owner.db, s.owner.context, placed.orderId);
  await recordCashCollected(s.owner.db, s.owner.context, placed.orderId);
  return getOrderForStaff(s.owner.db, s.owner.context, placed.orderId);
}

async function orderError(work: Promise<unknown>): Promise<OrderError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OrderError);
  return error as OrderError;
}

const level = (variantId: string) =>
  admin.inventoryLevel.findFirstOrThrow({ where: { variantId } });

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("returns", () => {
  let s: Awaited<ReturnType<typeof store>>;
  beforeAll(async () => {
    s = await store("returns");
  });

  it("put items back on the shelf, record money given back, and end in refunded", async () => {
    const item = await variant(s.tenantId, 1500, 5);
    const delivered = await deliveredOrder(s, item.id, 2);
    const line = delivered.items[0]!;
    expect(await level(item.id)).toMatchObject({ onHand: 3, reserved: 0, damaged: 0 });

    // One back, resellable, with part of the money.
    await recordReturn(s.owner.db, s.owner.context, {
      orderId: delivered.id,
      items: [{ orderItemId: line.id, quantity: "1", condition: "resellable" }],
      reason: "changed_mind",
      refund: "15.00",
      refundMethod: "cash",
    });
    expect(await level(item.id)).toMatchObject({ onHand: 4, damaged: 0 });
    let after = await getOrderForStaff(s.owner.db, s.owner.context, delivered.id);
    expect(after).toMatchObject({ status: "fulfilled", refundedAmount: 1500 });

    // Not more money than is left, nor more items than were bought.
    expect(
      (
        await orderError(
          recordReturn(s.owner.db, s.owner.context, {
            orderId: delivered.id,
            items: [{ orderItemId: line.id, quantity: "1", condition: "damaged" }],
            reason: "damaged",
            refund: "20.00",
            refundMethod: "cash",
          }),
        )
      ).message,
    ).toBe("At most $15.00 can be given back on this order.");
    await orderError(
      recordReturn(s.owner.db, s.owner.context, {
        orderId: delivered.id,
        items: [{ orderItemId: line.id, quantity: "2", condition: "resellable" }],
        reason: "other",
      }),
    );

    // The last one, damaged, with the rest of the money: the order is refunded.
    await recordReturn(s.owner.db, s.owner.context, {
      orderId: delivered.id,
      items: [{ orderItemId: line.id, quantity: "1", condition: "damaged" }],
      reason: "damaged",
      refund: "15",
      refundMethod: "bank_transfer",
    });
    expect(await level(item.id)).toMatchObject({ onHand: 5, damaged: 1 });
    after = await getOrderForStaff(s.owner.db, s.owner.context, delivered.id);
    expect(after).toMatchObject({ status: "refunded", refundedAmount: 3000 });
    expect(after.returns).toHaveLength(2);
    expect(after.events.filter((e) => e.type === "returned")).toHaveLength(2);
    const moves = await admin.stockMovement.findMany({
      where: { variantId: item.id, reason: "return" },
      select: { bucket: true, quantityDelta: true },
    });
    expect(moves).toHaveLength(3); // on hand +1, then on hand +1 and damaged +1

    // Everything is back: nothing more can be returned.
    expect(
      (
        await orderError(
          recordReturn(s.owner.db, s.owner.context, {
            orderId: delivered.id,
            items: [{ orderItemId: line.id, quantity: "1", condition: "resellable" }],
            reason: "other",
          }),
        )
      ).message,
    ).toMatch(/already been returned/);

    // The shopper is emailed about each return.
    const mail = createMemoryEmailProvider();
    await deliverPendingEmails(s.shop, mail, {
      appUrl: "http://localhost:3000",
      accessSecret: SECRET,
    });
    const returns = mail.sent.filter((m) => m.subject.startsWith("Return recorded"));
    expect(returns).toHaveLength(2);
    expect(returns[0]!.text).toContain("We have given back $15.00.");
  });

  it("are only for orders sent and paid, and refunds need their own permission", async () => {
    const item = await variant(s.tenantId, 1000);
    const unpaid = await order(s.shop, item.id);
    await fulfilOrder(s.owner.db, s.owner.context, unpaid.orderId);
    const sentUnpaid = await getOrderForStaff(s.owner.db, s.owner.context, unpaid.orderId);
    expect(
      (
        await orderError(
          recordReturn(s.owner.db, s.owner.context, {
            orderId: unpaid.orderId,
            items: [
              { orderItemId: sentUnpaid.items[0]!.id, quantity: "1", condition: "resellable" },
            ],
            reason: "changed_mind",
          }),
        )
      ).message,
    ).toMatch(/Delivery refused/);

    const delivered = await deliveredOrder(s, item.id, 1);
    const support = await staff(s.tenantId, "customer_service");
    const inventory = await staff(s.tenantId, "inventory_manager");
    const line = delivered.items[0]!.id;
    await expect(
      recordReturn(inventory.db, inventory.context, {
        orderId: delivered.id,
        items: [{ orderItemId: line, quantity: "1", condition: "resellable" }],
        reason: "other",
      }),
    ).rejects.toThrow(ForbiddenError);
    if (!support.context.permissions.has("orders.refund")) {
      await expect(
        recordReturn(support.db, support.context, {
          orderId: delivered.id,
          items: [{ orderItemId: line, quantity: "1", condition: "resellable" }],
          reason: "other",
          refund: "5.00",
          refundMethod: "cash",
        }),
      ).rejects.toThrow(ForbiddenError);
    }
    // Without money given back, customer service can record it.
    await recordReturn(support.db, support.context, {
      orderId: delivered.id,
      items: [{ orderItemId: line, quantity: "1", condition: "resellable" }],
      reason: "wrong_item",
    });
  });

  it("are kept to the rules by the database too", async () => {
    const item = await variant(s.tenantId, 1000);
    const one = await deliveredOrder(s, item.id, 1);
    const other = await deliveredOrder(s, item.id, 1);
    const created = await admin.orderReturn.create({
      data: { tenantId: s.tenantId, orderId: one.id, reason: "other" },
    });
    // A line from another order, or more than was bought, is refused.
    await expect(
      admin.orderReturnItem.create({
        data: {
          tenantId: s.tenantId,
          returnId: created.id,
          orderItemId: other.items[0]!.id,
          quantity: 1,
          condition: "resellable",
        },
      }),
    ).rejects.toThrow();
    await expect(
      admin.orderReturnItem.create({
        data: {
          tenantId: s.tenantId,
          returnId: created.id,
          orderItemId: one.items[0]!.id,
          quantity: 2,
          condition: "resellable",
        },
      }),
    ).rejects.toThrow();
    // Money given back never goes down or above the total.
    await admin.order.update({ where: { id: one.id }, data: { refundedAmount: 500 } });
    await expect(
      admin.order.update({ where: { id: one.id }, data: { refundedAmount: 100 } }),
    ).rejects.toThrow();
    await expect(
      admin.order.update({ where: { id: one.id }, data: { refundedAmount: 999_999 } }),
    ).rejects.toThrow();
    // The application can add returns but not change or remove them.
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.orderReturn.deleteMany({ where: { orderId: one.id } }),
      ),
    ).rejects.toThrow();
  });
});

describe("dashboard", () => {
  it("counts only orders taken, in the store's day, and only this store's", async () => {
    const s = await store("dash");
    const other = await store("dash-other");
    const item = await variant(s.tenantId, 2000);

    const confirmed = await order(s.shop, item.id); // sale: 20.00, to send
    await order(s.shop, item.id, { online: true }); // waiting for payment, not a sale
    const cancelled = await order(s.shop, item.id);
    await cancelUnpaidOrder(s.owner.db, s.owner.context, cancelled.orderId); // not a sale
    const sent = await order(s.shop, item.id, { quantity: 2 }); // sale: 40.00, cash to collect
    await fulfilOrder(s.owner.db, s.owner.context, sent.orderId);
    const delivered = await deliveredOrder(s, item.id, 1); // sale 20.00 less 5.00 refund
    await recordReturn(s.owner.db, s.owner.context, {
      orderId: delivered.id,
      items: [{ orderItemId: delivered.items[0]!.id, quantity: "1", condition: "resellable" }],
      reason: "other",
      refund: "5.00",
      refundMethod: "cash",
    });

    const data = await getDashboard(s.owner.db, s.owner.context);
    expect(data.timeZone).toBe("Asia/Beirut");
    expect(data.today).toEqual({ orders: 3, sales: 2000 + 4000 + 1500 });
    expect(data.last7Days).toEqual(data.today);
    expect(data.toSend).toBe(1);
    expect(data.cashToCollect).toEqual({ orders: 1, amount: 4000 });
    expect(data.awaitingPayment).toBe(1);
    expect(data.daily).toHaveLength(14);
    expect(data.daily[13]).toMatchObject({ day: zonedDay(new Date(), "Asia/Beirut"), orders: 3 });
    expect(data.recent[0]!.id).toBeDefined();
    expect(data.recent.some((o) => o.id === confirmed.orderId)).toBe(true);

    // Another store sees none of it.
    const elsewhere = await getDashboard(other.owner.db, other.owner.context);
    expect(elsewhere.today).toEqual({ orders: 0, sales: 0 });
    expect(elsewhere.recent).toEqual([]);

    // Staff without reports.read cannot see it.
    const stock = await staff(s.tenantId, "inventory_manager");
    if (!stock.context.permissions.has("reports.read")) {
      await expect(getDashboard(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("orders export and filters", () => {
  it("exports this store's orders as safe CSV, filtered, for staff allowed to, and audits it", async () => {
    const s = await store("export");
    const other = await store("export-other");
    const item = await variant(s.tenantId, 1250);
    const cash = await order(s.shop, item.id, { email: "cash@example.test" });
    const online = await order(s.shop, item.id, { online: true, email: "card@example.test" });
    await order(other.shop, await variant(other.tenantId, 999).then((v) => v.id), {
      email: "other-store@example.test",
    });

    const all = await exportOrdersCsv(s.owner.db, s.owner.context, {});
    expect(all.count).toBe(2);
    const [header, ...rows] = all.csv
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(header).toContain("Order,Placed (store time),Status,Payment,Email");
    expect(rows.some((row) => row.startsWith(`${cash.number},`))).toBe(true);
    // A phone number starting with + would be a formula in a spreadsheet.
    expect(all.csv).toContain("'+961 3 123 456");
    expect(all.csv).not.toContain("other-store@example.test");

    const cashOnly = await exportOrdersCsv(s.owner.db, s.owner.context, {
      paymentMethod: "cash_on_delivery",
    });
    expect(cashOnly.count).toBe(1);
    expect(cashOnly.csv).toContain("cash@example.test");

    const today = zonedDay(new Date(), "Asia/Beirut");
    expect((await listOrders(s.owner.db, s.owner.context, { from: today, to: today })).total).toBe(
      2,
    );
    expect((await listOrders(s.owner.db, s.owner.context, { from: addDays(today, 1) })).total).toBe(
      0,
    );
    expect((await listOrders(s.owner.db, s.owner.context, { to: addDays(today, -1) })).total).toBe(
      0,
    );
    expect(
      (await listOrders(s.owner.db, s.owner.context, { paymentMethod: "online" })).items.map(
        (o) => o.id,
      ),
    ).toEqual([online.orderId]);

    const logged = await admin.auditLog.count({
      where: { tenantId: s.tenantId, action: "orders.exported" },
    });
    expect(logged).toBe(2);

    // Staff whose role does not allow exporting customer data are refused.
    for (const role of ["inventory_manager", "content_editor"] as const) {
      const member = await staff(s.tenantId, role);
      if (!member.context.permissions.has("customers.export")) {
        await expect(exportOrdersCsv(member.db, member.context, {})).rejects.toThrow(
          ForbiddenError,
        );
      }
    }
  });
});
