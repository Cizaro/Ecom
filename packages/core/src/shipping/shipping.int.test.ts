import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { addToCart } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import {
  fulfilOrder,
  getOrderForShopper,
  OrderError,
  placeOrder,
  type PlaceOrderInput,
} from "../orders/orders";
import {
  createShippingZone,
  deleteShippingZone,
  getCheckoutOptions,
  listShippingZones,
  saveTaxSettings,
  ShippingError,
  updateShippingZone,
} from "./shipping";

// Delivery areas, tax and shipments against the real (test) database on the
// runtime connection, so Row-Level Security and the database's rules apply.
// Each test that changes a store's areas or tax uses its own store, because
// those settings change every checkout in that store.

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
    data: { name: `Shipping ${label} ${run}`, slug: `ship-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return { tenantId: tenant.id, shop: createTenantDb(app, { tenantId: tenant.id }) };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `ship-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.61",
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

async function cart(tenantId: string, shop: TenantDb, price: number, quantity = 1) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: { tenantId, name: `Wallet ${tag}`, slug: `wallet-${tag}`, status: "active" },
  });
  const variant = await admin.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      sku: `W-${tag}`,
      priceAmount: price,
      currency: "USD",
      trackInventory: false,
    },
  });
  const { token } = await addToCart(shop, null, { variantId: variant.id, quantity });
  return token!;
}

const order = (shop: TenantDb, token: string, extra: Partial<PlaceOrderInput> = {}) =>
  placeOrder(shop, {
    owner: { token },
    customer: null,
    email: "shopper@example.test",
    address: beirut,
    paymentMethod: "cash_on_delivery",
    accessSecret: SECRET,
    ...extra,
  });

async function orderError(work: Promise<unknown>): Promise<OrderError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OrderError);
  return error as OrderError;
}

let a: Awaited<ReturnType<typeof store>>;
let b: Awaited<ReturnType<typeof store>>;
let ownerA: Awaited<ReturnType<typeof staff>>;
let ownerB: Awaited<ReturnType<typeof staff>>;

beforeAll(async () => {
  a = await store("a");
  b = await store("b");
  ownerA = await staff(a.tenantId, "store_owner");
  ownerB = await staff(b.tenantId, "store_owner");
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("delivery areas", () => {
  it("are set by staff with settings.write, checked, and audited", async () => {
    const { id } = await createShippingZone(ownerA.db, ownerA.context, {
      name: " Beirut ",
      countries: "lb",
      rate: "3",
      freeOver: "100.00",
    });
    const { zones, currency } = await listShippingZones(ownerA.db, ownerA.context);
    expect(currency).toBe("USD");
    expect(zones).toEqual([
      expect.objectContaining({
        id,
        name: "Beirut",
        countries: ["LB"],
        rateAmount: 300,
        freeOverAmount: 10_000,
        isActive: true,
      }),
    ]);

    await expect(
      createShippingZone(ownerA.db, ownerA.context, {
        name: "beirut2",
        countries: "LB",
        rate: "x",
      }),
    ).rejects.toThrow(ShippingError);
    await expect(
      createShippingZone(ownerA.db, ownerA.context, { name: "Beirut", countries: "LB", rate: "1" }),
    ).rejects.toThrow(/already has this name/);
    await expect(
      createShippingZone(ownerA.db, ownerA.context, { name: "Moon", countries: "ZZ", rate: "1" }),
    ).rejects.toThrow(/not a country code/);

    const stock = await staff(a.tenantId, "inventory_manager");
    await expect(listShippingZones(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
    await expect(
      createShippingZone(stock.db, stock.context, { name: "X", countries: "LB", rate: "1" }),
    ).rejects.toThrow(ForbiddenError);

    const logged = await admin.auditLog.findMany({
      where: { tenantId: a.tenantId, entityId: id },
      select: { action: true },
    });
    expect(logged.map((row) => row.action)).toContain("settings.shipping_zone_created");
  });

  it("belong to one store: another store cannot see, change or delete them", async () => {
    const { id } = await createShippingZone(ownerA.db, ownerA.context, {
      name: `Private ${run}`,
      countries: "LB",
      rate: "4",
    });
    expect((await listShippingZones(ownerB.db, ownerB.context)).zones).toEqual([]);
    expect((await getCheckoutOptions(b.shop)).zones).toEqual([]);
    await expect(
      updateShippingZone(ownerB.db, ownerB.context, id, {
        name: "Mine",
        countries: "LB",
        rate: "0",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(deleteShippingZone(ownerB.db, ownerB.context, id)).rejects.toThrow(NotFoundError);
    // Directly in the database, as store B: invisible.
    const seen = await withTenant(app, { tenantId: b.tenantId }, (tx) =>
      tx.shippingZone.findMany({ where: { id } }),
    );
    expect(seen).toEqual([]);
    // Store B's checkout refuses store A's area.
    const token = await cart(b.tenantId, b.shop, 1000);
    // While store B has no areas of its own, delivery is free and the id is ignored.
    expect((await order(b.shop, token, { shippingZoneId: id })).order).toMatchObject({
      shippingAmount: 0,
      shippingZoneName: null,
    });
    await createShippingZone(ownerB.db, ownerB.context, {
      name: "B area",
      countries: "LB",
      rate: "2",
    });
    const error = await orderError(
      order(b.shop, await cart(b.tenantId, b.shop, 1000), { shippingZoneId: id }),
    );
    expect(error.message).toBe("Choose a delivery area.");
  });
});

describe("checkout with delivery and tax", () => {
  it("charges the picked area, free above its amount, and refuses areas that do not fit", async () => {
    const s = await store("checkout");
    const owner = await staff(s.tenantId, "store_owner");
    const city = await createShippingZone(owner.db, owner.context, {
      name: "Beirut",
      countries: "LB",
      rate: "3.00",
      freeOver: "50.00",
    });
    const off = await createShippingZone(owner.db, owner.context, {
      name: "Closed area",
      countries: "LB",
      rate: "1.00",
      isActive: false,
    });
    const abroad = await createShippingZone(owner.db, owner.context, {
      name: "Syria",
      countries: "SY",
      rate: "15.00",
    });
    const options = await getCheckoutOptions(s.shop);
    expect(options.zones.map((zone) => zone.name)).toEqual(["Beirut", "Syria"]);

    // An area must be picked, it must be offered, and it must cover the country.
    expect((await orderError(order(s.shop, await cart(s.tenantId, s.shop, 2000)))).field).toBe(
      "shippingZoneId",
    );
    await orderError(
      order(s.shop, await cart(s.tenantId, s.shop, 2000), { shippingZoneId: off.id }),
    );
    const wrong = await orderError(
      order(s.shop, await cart(s.tenantId, s.shop, 2000), { shippingZoneId: abroad.id }),
    );
    expect(wrong.message).toMatch(/Syria is not in Lebanon/);
    const nowhere = await orderError(
      order(s.shop, await cart(s.tenantId, s.shop, 2000), {
        shippingZoneId: city.id,
        address: { ...beirut, country: "FR", postalCode: "75001" },
      }),
    );
    expect(nowhere.message).toBe("Sorry, we do not deliver to France yet.");

    // Under the free-delivery amount the fee is added; at it, delivery is free.
    const small = await order(s.shop, await cart(s.tenantId, s.shop, 2000), {
      shippingZoneId: city.id,
      pricingVersion: options.version,
    });
    expect(small.order).toMatchObject({
      subtotalAmount: 2000,
      shippingAmount: 300,
      totalAmount: 2300,
      shippingZoneName: "Beirut",
      taxRateBasisPoints: 0,
    });
    const big = await order(s.shop, await cart(s.tenantId, s.shop, 2500, 2), {
      shippingZoneId: city.id,
    });
    expect(big.order).toMatchObject({ shippingAmount: 0, totalAmount: 5000 });
  });

  it("adds tax or shows it as included, and refuses prices that changed after the shopper saw them", async () => {
    const s = await store("tax");
    const owner = await staff(s.tenantId, "store_owner");
    const city = await createShippingZone(owner.db, owner.context, {
      name: "Beirut",
      countries: "LB",
      rate: "5.00",
    });
    await saveTaxSettings(owner.db, owner.context, { rate: "11", included: "false", label: "VAT" });
    const seen = await getCheckoutOptions(s.shop);
    const added = await order(s.shop, await cart(s.tenantId, s.shop, 10_000), {
      shippingZoneId: city.id,
      pricingVersion: seen.version,
    });
    // (100 + 5) * 11% = 11.55
    expect(added.order).toMatchObject({
      shippingAmount: 500,
      taxAmount: 1155,
      taxIncludedAmount: 0,
      totalAmount: 11_655,
      taxRateBasisPoints: 1100,
      taxLabel: "VAT",
    });

    // Staff switch to tax-inclusive prices: an old page's version is refused.
    await saveTaxSettings(owner.db, owner.context, { rate: "11", included: "true", label: "TVA" });
    const stale = await orderError(
      order(s.shop, await cart(s.tenantId, s.shop, 10_000), {
        shippingZoneId: city.id,
        pricingVersion: seen.version,
      }),
    );
    expect(stale.message).toMatch(/have just changed/);
    const included = await order(s.shop, await cart(s.tenantId, s.shop, 10_000), {
      shippingZoneId: city.id,
      pricingVersion: (await getCheckoutOptions(s.shop)).version,
    });
    // 105.00 includes 11%: 10.41 of it is tax.
    expect(included.order).toMatchObject({
      taxAmount: 0,
      taxIncludedAmount: 1041,
      totalAmount: 10_500,
      taxLabel: "TVA",
    });

    // Staff cannot set an impossible rate.
    await expect(
      saveTaxSettings(owner.db, owner.context, { rate: "75", included: "true", label: "VAT" }),
    ).rejects.toThrow(ShippingError);

    // Later price changes and deletions never alter a placed order.
    await updateShippingZone(owner.db, owner.context, city.id, {
      name: "Beirut city",
      countries: "LB",
      rate: "9.00",
    });
    await deleteShippingZone(owner.db, owner.context, city.id);
    const kept = await getOrderForShopper(s.shop, added.orderId, { accessKey: added.accessKey });
    expect(kept).toMatchObject({
      shippingZoneName: "Beirut",
      shippingAmount: 500,
      totalAmount: 11_655,
    });
    // And the database refuses to rewrite them.
    await expect(
      admin.order.update({ where: { id: added.orderId }, data: { shippingZoneName: "Other" } }),
    ).rejects.toThrow();
    await expect(
      admin.order.update({ where: { id: added.orderId }, data: { taxRateBasisPoints: 0 } }),
    ).rejects.toThrow();
  });
});

describe("shipments", () => {
  it("record the courier and tracking when sent, accept only https links, and cannot be edited", async () => {
    const s = await store("shipments");
    const owner = await staff(s.tenantId, "store_owner");
    const placed = await order(s.shop, await cart(s.tenantId, s.shop, 1500));
    await expect(
      fulfilOrder(owner.db, owner.context, placed.orderId, {
        courier: "Aramex",
        trackingUrl: "javascript:alert(1)",
      }),
    ).rejects.toThrow(/https/);
    await fulfilOrder(owner.db, owner.context, placed.orderId, {
      courier: "  Aramex  ",
      trackingReference: "AX123",
      trackingUrl: "https://track.example.test/AX123",
      note: "Left at 3pm",
    });
    const seen = await getOrderForShopper(s.shop, placed.orderId, { accessKey: placed.accessKey });
    expect(seen.shipment).toMatchObject({
      courier: "Aramex",
      trackingReference: "AX123",
      trackingUrl: "https://track.example.test/AX123",
    });
    // A shipment is a record: the application can add it, never change or delete it.
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.shipment.updateMany({ where: { orderId: placed.orderId }, data: { courier: "X" } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.shipment.deleteMany({ where: { orderId: placed.orderId } }),
      ),
    ).rejects.toThrow();
    // Another store cannot see it.
    const other = await withTenant(app, { tenantId: a.tenantId }, (tx) =>
      tx.shipment.findMany({ where: { orderId: placed.orderId } }),
    );
    expect(other).toEqual([]);
  });
});
