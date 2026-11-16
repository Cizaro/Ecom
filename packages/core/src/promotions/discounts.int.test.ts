import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { addToCart } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { cancelUnpaidOrder, OrderError, placeOrder } from "../orders/orders";
import { createShippingZone } from "../shipping/shipping";
import {
  checkDiscountCode,
  createDiscountCode,
  deleteDiscountCode,
  DiscountError,
  listDiscountCodes,
  updateDiscountCode,
} from "./discounts";

// Discount codes against the real (test) database on the runtime connection,
// so Row-Level Security and the database's own rules apply.

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

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Codes ${label} ${run}`, slug: `codes-${label}-${run}` },
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
    data: { email: `codes-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.64",
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

async function product(tenantId: string, price: number) {
  const tag = randomUUID().slice(0, 8);
  const row = await admin.product.create({
    data: { tenantId, name: `Scarf ${tag}`, slug: `scarf-${tag}`, status: "active" },
  });
  return admin.productVariant.create({
    data: {
      tenantId,
      productId: row.id,
      sku: `SC-${tag}`,
      priceAmount: price,
      currency: "USD",
      trackInventory: false,
    },
  });
}

async function order(
  shop: TenantDb,
  variantId: string,
  extra: { discountCode?: string; email?: string; shippingZoneId?: string } = {},
) {
  const { token } = await addToCart(shop, null, { variantId, quantity: 1 });
  return placeOrder(shop, {
    owner: { token: token! },
    customer: null,
    email: extra.email ?? "rami@example.test",
    address: beirut,
    paymentMethod: "cash_on_delivery",
    accessSecret: SECRET,
    discountCode: extra.discountCode,
    shippingZoneId: extra.shippingZoneId,
  });
}

async function orderError(work: Promise<unknown>): Promise<OrderError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OrderError);
  return error as OrderError;
}

let s: Awaited<ReturnType<typeof store>>;
let other: Awaited<ReturnType<typeof store>>;

beforeAll(async () => {
  s = await store("main");
  other = await store("other");
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("staff", () => {
  it("make codes with clear checks, only with promotions.write, and audited", async () => {
    const { id } = await createDiscountCode(s.owner.db, s.owner.context, {
      code: " welcome 10 ",
      kind: "percent",
      value: "10",
    });
    const { codes } = await listDiscountCodes(s.owner.db, s.owner.context);
    expect(codes).toEqual([
      expect.objectContaining({ id, code: "WELCOME10", kind: "percent", value: 10, used: 0 }),
    ]);
    await expect(
      createDiscountCode(s.owner.db, s.owner.context, {
        code: "WELCOME10",
        kind: "fixed",
        value: "5",
      }),
    ).rejects.toThrow(/already uses this code/);
    for (const bad of [
      { code: "X", kind: "percent", value: "10" },
      { code: "TOO-MUCH", kind: "percent", value: "150" },
      { code: "NOAMOUNT", kind: "fixed", value: "" },
      { code: "BADDATES", kind: "free_delivery", startsOn: "2026-12-10", endsOn: "2026-12-01" },
    ]) {
      await expect(createDiscountCode(s.owner.db, s.owner.context, bad)).rejects.toThrow(
        DiscountError,
      );
    }
    const stock = await staff(s.tenantId, "inventory_manager");
    await expect(listDiscountCodes(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
    const logged = await admin.auditLog.count({
      where: { tenantId: s.tenantId, action: "promotions.code_created" },
    });
    expect(logged).toBe(1);
  });
});

describe("at checkout", () => {
  it("take money off, are recorded on the order, and refuse codes that do not apply", async () => {
    const item = await product(s.tenantId, 4000);
    await createDiscountCode(s.owner.db, s.owner.context, {
      code: "TENOFF",
      kind: "fixed",
      value: "10.00",
      minSubtotal: "30.00",
    });
    await createDiscountCode(s.owner.db, s.owner.context, {
      code: "ENDED",
      kind: "percent",
      value: "50",
      startsOn: "2025-01-01",
      endsOn: "2025-01-31",
    });
    await createDiscountCode(s.owner.db, s.owner.context, {
      code: "LATER",
      kind: "percent",
      value: "50",
      startsOn: "2099-01-01",
    });
    await createDiscountCode(s.owner.db, s.owner.context, {
      code: "SWITCHEDOFF",
      kind: "percent",
      value: "50",
      isActive: false,
    });
    await createDiscountCode(other.owner.db, other.owner.context, {
      code: "THEIRS",
      kind: "percent",
      value: "50",
    });

    const placed = await order(s.shop, item.id, { discountCode: "tenoff" });
    expect(placed.order).toMatchObject({
      subtotalAmount: 4000,
      discountAmount: 1000,
      discountCode: "TENOFF",
      totalAmount: 3000,
    });
    expect(
      await admin.discountRedemption.findUnique({ where: { orderId: placed.orderId } }),
    ).toMatchObject({ amount: 1000, email: "rami@example.test" });

    const cheap = await product(s.tenantId, 1000);
    expect((await orderError(order(s.shop, cheap.id, { discountCode: "TENOFF" }))).message).toBe(
      "This code needs items worth at least $30.00.",
    );
    expect((await orderError(order(s.shop, item.id, { discountCode: "ENDED" }))).message).toBe(
      "That discount code has ended.",
    );
    for (const code of ["LATER", "SWITCHEDOFF", "THEIRS", "NOPE"]) {
      const error = await orderError(order(s.shop, item.id, { discountCode: code }));
      expect(error.message).toBe("That discount code is not valid.");
      expect(error.field).toBe("discountCode");
    }
    // Checking at checkout gives the same answers without holding anything.
    await expect(
      checkDiscountCode(s.shop, { code: "THEIRS", subtotalAmount: 4000, currency: "USD" }),
    ).rejects.toThrow("That discount code is not valid.");
    expect(
      await checkDiscountCode(s.shop, { code: "TENOFF", subtotalAmount: 4000, currency: "USD" }),
    ).toMatchObject({ code: "TENOFF", kind: "fixed", value: 1000 });
  });

  it("give free delivery as a discount equal to the fee", async () => {
    const t = await store("delivery");
    const item = await product(t.tenantId, 2000);
    const area = await createShippingZone(t.owner.db, t.owner.context, {
      name: "All of Lebanon",
      countries: "LB",
      rate: "4.00",
    });
    await createDiscountCode(t.owner.db, t.owner.context, {
      code: "SHIPFREE",
      kind: "free_delivery",
    });
    const placed = await order(t.shop, item.id, {
      discountCode: "SHIPFREE",
      shippingZoneId: area.id,
    });
    expect(placed.order).toMatchObject({
      shippingAmount: 400,
      discountAmount: 400,
      totalAmount: 2000,
    });
  });

  it("never let two orders take a code's last use; a cancelled order gives it back", async () => {
    const item = await product(s.tenantId, 2000);
    await createDiscountCode(s.owner.db, s.owner.context, {
      code: "ONLYONCE",
      kind: "percent",
      value: "20",
      usageLimit: "1",
    });
    const results = await Promise.allSettled([
      order(s.shop, item.id, { discountCode: "ONLYONCE", email: "a@example.test" }),
      order(s.shop, item.id, { discountCode: "ONLYONCE", email: "b@example.test" }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(((lost[0] as PromiseRejectedResult).reason as Error).message).toBe(
      "That discount code has been used up.",
    );

    const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof order>>>).value;
    await cancelUnpaidOrder(s.owner.db, s.owner.context, winner.orderId);
    const again = await order(s.shop, item.id, { discountCode: "ONLYONCE" });
    expect(again.order?.discountAmount).toBe(400);
  });

  it("keep to the uses allowed per customer", async () => {
    const item = await product(s.tenantId, 2000);
    await createDiscountCode(s.owner.db, s.owner.context, {
      code: "ONEEACH",
      kind: "percent",
      value: "5",
      perCustomerLimit: "1",
    });
    await order(s.shop, item.id, { discountCode: "ONEEACH", email: "nour@example.test" });
    expect(
      (
        await orderError(
          order(s.shop, item.id, { discountCode: "ONEEACH", email: "NOUR@example.test" }),
        )
      ).message,
    ).toMatch(/already used this discount code/);
    await order(s.shop, item.id, { discountCode: "ONEEACH", email: "someone@example.test" });
  });
});

describe("records", () => {
  it("keep a used code, and the order's discount cannot be rewritten", async () => {
    const item = await product(s.tenantId, 3000);
    const { id } = await createDiscountCode(s.owner.db, s.owner.context, {
      code: "KEEPME",
      kind: "fixed",
      value: "3",
    });
    const placed = await order(s.shop, item.id, { discountCode: "KEEPME" });
    await expect(deleteDiscountCode(s.owner.db, s.owner.context, id)).rejects.toThrow(
      /Switch it off instead/,
    );
    await updateDiscountCode(s.owner.db, s.owner.context, id, {
      code: "KEEPME",
      kind: "fixed",
      value: "3",
      isActive: false,
    });
    await expect(
      admin.order.update({ where: { id: placed.orderId }, data: { discountCode: "OTHER" } }),
    ).rejects.toThrow();
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.discountRedemption.deleteMany({ where: { orderId: placed.orderId } }),
      ),
    ).rejects.toThrow();
    // An unused code can be deleted.
    const unused = await createDiscountCode(s.owner.db, s.owner.context, {
      code: "UNUSED",
      kind: "percent",
      value: "5",
    });
    await deleteDiscountCode(s.owner.db, s.owner.context, unused.id);
    // Another store cannot see or change this store's codes.
    expect(
      (await listDiscountCodes(other.owner.db, other.owner.context)).codes.map((c) => c.code),
    ).toEqual(["THEIRS"]);
    await expect(
      updateDiscountCode(other.owner.db, other.owner.context, id, {
        code: "STOLEN",
        kind: "percent",
        value: "99",
      }),
    ).rejects.toThrow();
  });
});
