import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { addToCart, getCart } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { getAvailability } from "../inventory/stock";
import { createMockPaymentProvider } from "../payments/provider";
import { findPaymentTenant, listTenantsWithExpiredOrders } from "../platform/payment-lookup";
import {
  cancelUnpaidOrder,
  expireUnpaidOrders,
  fulfilOrder,
  getOrderForShopper,
  getOrderForStaff,
  handlePaymentNotification,
  listCustomerOrders,
  listOrders,
  orderAccessKey,
  OrderError,
  placeOrder,
  recordCashCollected,
  recordDeliveryRefused,
  startPayment,
  type OrderErrorCode,
} from "./orders";

// Checkout and orders against the real (test) database on the runtime
// connection, so Row-Level Security and the database's own rules apply.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const provider = createMockPaymentProvider({ webhookSecret: "w".repeat(40) });
const SECRET = "k".repeat(40);

let tenantA: string;
let tenantB: string;
let shopA: TenantDb;
let shopB: TenantDb;

const address = {
  fullName: "Sam Shopper",
  line1: "1 Nile Street",
  city: "Cairo",
  country: "EG",
};

async function createTenant(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Orders ${label} ${run}`, slug: `orders-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `orders-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.60",
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
async function variant(tenantId: string, price = 2500, stock?: number) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: { tenantId, name: `Bag ${tag}`, slug: `bag-${tag}`, status: "active" },
  });
  const row = await admin.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      sku: `BAG-${tag}`,
      color: "Black",
      priceAmount: price,
      currency: "USD",
      trackInventory: stock !== undefined,
    },
  });
  if (stock !== undefined && stock > 0) {
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

/** A guest with a cart holding `quantity` of the variant. */
async function guestCart(db: TenantDb, variantId: string, quantity = 1) {
  const { token } = await addToCart(db, null, { variantId, quantity });
  return token!;
}

async function placeAndStart(db: TenantDb, token: string, email = "guest@example.test") {
  const placed = await placeOrder(db, {
    owner: { token },
    customer: null,
    email,
    address,
    accessSecret: SECRET,
  });
  const { payUrl } = await startPayment(db, provider, placed.orderId, `/order/${placed.orderId}`);
  const providerPaymentId = new URL(payUrl, "http://x").searchParams.get("payment")!;
  return { ...placed, providerPaymentId };
}

/** Delivers a signed notification the way the webhook route does. */
async function notify(
  db: TenantDb,
  providerPaymentId: string,
  outcome: "succeed" | "decline",
  amount: number,
  currency = "USD",
) {
  const { body, headers } = provider.notificationFor({
    outcome,
    providerPaymentId,
    amount,
    currency,
  });
  const notification = provider.verifyNotification(body, headers);
  return { notification, result: await handlePaymentNotification(db, "mock", notification) };
}

async function expectOrderError(work: Promise<unknown>, code: OrderErrorCode) {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected OrderError ${code}`).toBeInstanceOf(OrderError);
  expect((error as OrderError).code).toBe(code);
}

beforeAll(async () => {
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  shopA = createTenantDb(app, { tenantId: tenantA });
  shopB = createTenantDb(app, { tenantId: tenantB });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("placing and paying for an order", () => {
  it("copies the cart into an order, holds stock, and only a payment makes it paid", async () => {
    const item = await variant(tenantA, 2500, 5);
    const token = await guestCart(shopA, item.id, 2);
    const placed = await placeAndStart(shopA, token, " Guest@Example.Test ");

    let order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order).toMatchObject({
      number: placed.number,
      status: "pending_payment",
      email: "guest@example.test",
      customerId: null,
      currency: "USD",
      subtotalAmount: 5000,
      totalAmount: 5000,
      shippingAddress: { fullName: "Sam Shopper", city: "Cairo", country: "EG" },
    });
    expect(order.items).toEqual([
      expect.objectContaining({
        sku: item.sku,
        quantity: 2,
        unitPriceAmount: 2500,
        lineTotalAmount: 5000,
      }),
    ]);
    expect(order.payments).toEqual([expect.objectContaining({ status: "pending", amount: 5000 })]);
    // Stock is held; the cart is still there until payment succeeds.
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(3);
    expect((await getCart(shopA, token)).itemCount).toBe(2);

    // A later price change does not touch the order.
    await admin.productVariant.update({ where: { id: item.id }, data: { priceAmount: 9900 } });

    const { result } = await notify(shopA, placed.providerPaymentId, "succeed", 5000);
    expect(result.outcome).toBe("paid");
    expect(result.order?.number).toBe(placed.number);

    order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("paid");
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(order.items[0]!.unitPriceAmount).toBe(2500);
    expect(order.payments[0]).toMatchObject({
      status: "succeeded",
      methodBrand: "Test card",
      methodLast4: "4242",
    });
    // The stock has left the shelf, and the cart is closed.
    const stock = await admin.inventoryLevel.findFirstOrThrow({ where: { variantId: item.id } });
    expect(stock).toMatchObject({ onHand: 3, reserved: 0 });
    expect((await getCart(shopA, token)).lines).toEqual([]);
  });

  it("numbers each store's orders on their own, from 1001", async () => {
    const fresh = await createTenant(`num-${randomUUID().slice(0, 4)}`);
    const shop = createTenantDb(app, { tenantId: fresh });
    const item = await variant(fresh);
    const first = await placeOrder(shop, {
      owner: { token: await guestCart(shop, item.id) },
      customer: null,
      email: "a@example.test",
      address,
      accessSecret: SECRET,
    });
    const second = await placeOrder(shop, {
      owner: { token: await guestCart(shop, item.id) },
      customer: null,
      email: "b@example.test",
      address,
      accessSecret: SECRET,
    });
    expect([first.number, second.number]).toEqual([1001, 1002]);
  });

  it("acts on each notification once, however often it arrives", async () => {
    const item = await variant(tenantA, 1000, 4);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id, 2));
    const { notification, result } = await notify(shopA, placed.providerPaymentId, "succeed", 2000);
    expect(result.outcome).toBe("paid");
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect((await handlePaymentNotification(shopA, "mock", notification)).outcome).toBe(
        "duplicate",
      );
    }
    // A second, different "succeeded" notification for the same payment changes nothing either.
    expect((await notify(shopA, placed.providerPaymentId, "succeed", 2000)).result.outcome).toBe(
      "already_settled",
    );
    const stock = await admin.inventoryLevel.findFirstOrThrow({ where: { variantId: item.id } });
    expect(stock).toMatchObject({ onHand: 2, reserved: 0 });
    expect(
      await admin.paymentEvent.count({ where: { payment: { orderId: placed.orderId } } }),
    ).toBe(2);
  });

  it("ignores a notification whose amount does not match the payment", async () => {
    const item = await variant(tenantA, 1000);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id));
    expect((await notify(shopA, placed.providerPaymentId, "succeed", 1)).result.outcome).toBe(
      "mismatch",
    );
    expect(
      (await notify(shopA, placed.providerPaymentId, "succeed", 1000, "EUR")).result.outcome,
    ).toBe("mismatch");
    const order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("pending_payment");
  });

  it("lets the shopper try again after a decline", async () => {
    const item = await variant(tenantA, 1500);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id));
    expect((await notify(shopA, placed.providerPaymentId, "decline", 1500)).result.outcome).toBe(
      "failed",
    );
    let order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("pending_payment");
    expect(order.payments[0]).toMatchObject({
      status: "failed",
      failureMessage: expect.stringContaining("declined"),
    });

    const retry = await startPayment(shopA, provider, placed.orderId, "/order/x");
    const second = new URL(retry.payUrl, "http://x").searchParams.get("payment")!;
    expect((await notify(shopA, second, "succeed", 1500)).result.outcome).toBe("paid");
    order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("paid");
    expect(order.payments.map((payment) => payment.status)).toEqual(["succeeded", "failed"]);
    await expectOrderError(startPayment(shopA, provider, placed.orderId, "/x"), "not_payable");
  });

  it("finds a payment's store from the provider's reference, and no other store can act on it", async () => {
    const item = await variant(tenantA, 1200);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id));
    expect(await findPaymentTenant(env.DATABASE_ADMIN_URL, placed.providerPaymentId)).toBe(tenantA);
    expect(await findPaymentTenant(env.DATABASE_ADMIN_URL, "mock_nope")).toBeNull();
    expect((await notify(shopB, placed.providerPaymentId, "succeed", 1200)).result.outcome).toBe(
      "unknown_payment",
    );
    const order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("pending_payment");
  });
});

describe("what cannot be ordered", () => {
  it("never sells the last item twice", async () => {
    const item = await variant(tenantA, 3000, 1);
    const tokens = await Promise.all(Array.from({ length: 5 }, () => guestCart(shopA, item.id)));
    const results = await Promise.allSettled(
      tokens.map((token) =>
        placeOrder(createTenantDb(app, { tenantId: tenantA }), {
          owner: { token },
          customer: null,
          email: "racer@example.test",
          address,
          accessSecret: SECRET,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(OrderError);
    }
    // The losers left no order behind.
    expect(await admin.orderItem.count({ where: { variantId: item.id } })).toBe(1);
  });

  it("refuses an empty cart, a changed price, an unavailable item and a bad address", async () => {
    const item = await variant(tenantA, 1000);
    await expectOrderError(
      placeOrder(shopA, {
        owner: { token: null },
        customer: null,
        email: "g@example.test",
        address,
        accessSecret: SECRET,
      }),
      "empty_cart",
    );
    const token = await guestCart(shopA, item.id, 2);
    await expectOrderError(
      placeOrder(shopA, {
        owner: { token },
        customer: null,
        email: "g@example.test",
        address,
        expectedTotal: 1500,
        accessSecret: SECRET,
      }),
      "cart_changed",
    );
    await expectOrderError(
      placeOrder(shopA, {
        owner: { token },
        customer: null,
        email: "not-an-email",
        address,
        accessSecret: SECRET,
      }),
      "invalid",
    );
    await expectOrderError(
      placeOrder(shopA, {
        owner: { token },
        customer: null,
        email: "g@example.test",
        address: { ...address, country: "US", region: "TX", postalCode: "nope" },
        accessSecret: SECRET,
      }),
      "invalid",
    );
    await admin.product.update({ where: { id: item.productId }, data: { status: "draft" } });
    await expectOrderError(
      placeOrder(shopA, {
        owner: { token },
        customer: null,
        email: "g@example.test",
        address,
        accessSecret: SECRET,
      }),
      "cart_changed",
    );
    expect(await admin.orderItem.count({ where: { variantId: item.id } })).toBe(0);
  });
});

describe("who can see an order", () => {
  it("opens with the right key or for the customer who placed it, and for nobody else", async () => {
    const item = await variant(tenantA, 1000);
    const guest = await placeAndStart(shopA, await guestCart(shopA, item.id));
    const owner = await admin.customer.create({
      data: { tenantId: tenantA, email: `owner-${run}@example.test`, emailVerifiedAt: new Date() },
    });
    const stranger = await admin.customer.create({
      data: {
        tenantId: tenantA,
        email: `stranger-${run}@example.test`,
        emailVerifiedAt: new Date(),
      },
    });
    const { token } = await addToCart(
      shopA,
      { customerId: owner.id },
      { variantId: item.id, quantity: 1 },
    );
    expect(token).toBeNull();
    const mine = await placeOrder(shopA, {
      owner: { customerId: owner.id },
      customer: { id: owner.id, email: owner.email },
      email: "ignored@example.test",
      address,
      accessSecret: SECRET,
    });

    expect((await getOrderForShopper(shopA, mine.orderId, { customerId: owner.id })).email).toBe(
      owner.email,
    );
    expect((await listCustomerOrders(shopA, owner.id)).map((order) => order.id)).toEqual([
      mine.orderId,
    ]);
    expect(await listCustomerOrders(shopA, stranger.id)).toEqual([]);

    const denied: [string, { customerId?: string; accessKey?: string }][] = [
      [mine.orderId, { customerId: stranger.id }],
      [mine.orderId, { accessKey: guest.accessKey }],
      [guest.orderId, { accessKey: `${guest.accessKey.slice(0, -1)}x` }],
      [guest.orderId, { accessKey: "" }],
      [guest.orderId, { customerId: owner.id }],
      [guest.orderId, {}],
      ["not-an-id", { accessKey: guest.accessKey }],
    ];
    for (const [id, access] of denied) {
      await expect(getOrderForShopper(shopA, id, access)).rejects.toBeInstanceOf(NotFoundError);
    }
    // The right key, from the wrong store.
    await expect(
      getOrderForShopper(shopB, guest.orderId, { accessKey: guest.accessKey }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // A guest order with an account holder's email stays out of that account.
    const sameEmail = await placeOrder(shopA, {
      owner: { token: await guestCart(shopA, item.id) },
      customer: null,
      email: owner.email,
      address,
      accessSecret: SECRET,
    });
    expect((await listCustomerOrders(shopA, owner.id)).map((order) => order.id)).not.toContain(
      sameEmail.orderId,
    );
  });
});

describe("unpaid orders", () => {
  it("are cancelled when time runs out, giving their stock back", async () => {
    const item = await variant(tenantA, 1000, 2);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id, 2));
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(0);
    const later = new Date(Date.now() + 60 * 60_000);
    expect(await listTenantsWithExpiredOrders(env.DATABASE_ADMIN_URL, later)).toContain(tenantA);
    expect(await expireUnpaidOrders(shopA, later)).toBeGreaterThanOrEqual(1);
    const order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("cancelled");
    expect(order.payments[0]!.status).toBe("cancelled");
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(2);
    await expectOrderError(startPayment(shopA, provider, placed.orderId, "/x"), "not_payable");
  });

  it("flag a payment that arrives after cancellation, for a refund", async () => {
    const item = await variant(tenantA, 1000);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id));
    await expireUnpaidOrders(shopA, new Date(Date.now() + 60 * 60_000));
    // The payment was already marked cancelled; a provider can still report it succeeded.
    await admin.payment.updateMany({
      where: { orderId: placed.orderId },
      data: { status: "pending" },
    });
    expect((await notify(shopA, placed.providerPaymentId, "succeed", 1000)).result.outcome).toBe(
      "paid_after_cancellation",
    );
    const owner = await staff(tenantA, "store_owner");
    const order = await getOrderForStaff(owner.db, owner.context, placed.orderId);
    expect(order.status).toBe("cancelled");
    expect(order.events.map((event) => event.type)).toContain("paid_after_cancellation");
  });
});

describe("the database guards the record", () => {
  it("allows only the defined status steps and never changes what an order cost", async () => {
    const item = await variant(tenantA, 1000);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id));
    await expect(
      admin.order.update({ where: { id: placed.orderId }, data: { status: "fulfilled" } }),
    ).rejects.toThrow();
    await expect(
      admin.order.update({
        where: { id: placed.orderId },
        data: { totalAmount: 1, subtotalAmount: 1 },
      }),
    ).rejects.toThrow();
    await notify(shopA, placed.providerPaymentId, "succeed", 1000);
    await expect(
      admin.order.update({ where: { id: placed.orderId }, data: { status: "pending_payment" } }),
    ).rejects.toThrow();
    // Order lines and history cannot be changed by the application.
    await expect(
      withTenant(app, { tenantId: tenantA }, (tx) =>
        tx.orderItem.updateMany({
          where: { orderId: placed.orderId },
          data: { unitPriceAmount: 1 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, { tenantId: tenantA }, (tx) =>
        tx.orderEvent.deleteMany({ where: { orderId: placed.orderId } }),
      ),
    ).rejects.toThrow();
  });
});

describe("staff", () => {
  it("find, fulfil and cancel orders within the rules and their permissions", async () => {
    const owner = await staff(tenantA, "store_owner");
    const support = await staff(tenantA, "customer_service");
    const marketer = await staff(tenantA, "marketer");
    const item = await variant(tenantA, 1000, 3);
    const email = `find-${run}@example.test`;
    const paid = await placeAndStart(shopA, await guestCart(shopA, item.id), email);
    await notify(shopA, paid.providerPaymentId, "succeed", 1000);
    const unpaid = await placeAndStart(shopA, await guestCart(shopA, item.id), email);

    const byEmail = await listOrders(owner.db, owner.context, { search: email.toUpperCase() });
    expect(byEmail.items.map((order) => order.number).sort()).toEqual(
      [paid.number, unpaid.number].sort(),
    );
    const byNumber = await listOrders(owner.db, owner.context, { search: `#${paid.number}` });
    expect(byNumber.items.map((order) => order.id)).toEqual([paid.orderId]);
    const onlyPaid = await listOrders(owner.db, owner.context, { status: "paid", search: email });
    expect(onlyPaid.items.map((order) => order.id)).toEqual([paid.orderId]);

    await expectOrderError(fulfilOrder(owner.db, owner.context, unpaid.orderId), "not_allowed");
    await expectOrderError(cancelUnpaidOrder(owner.db, owner.context, paid.orderId), "not_allowed");
    await fulfilOrder(owner.db, owner.context, paid.orderId, "Sent by courier");
    await cancelUnpaidOrder(owner.db, owner.context, unpaid.orderId);
    const fulfilled = await getOrderForStaff(owner.db, owner.context, paid.orderId);
    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.events.map((event) => [event.type, event.actorType])).toEqual([
      ["placed", "guest"],
      ["paid", "payment_provider"],
      ["fulfilled", "staff"],
    ]);
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(2);

    // Customer service can look but not change; a marketer cannot look.
    await getOrderForStaff(support.db, support.context, paid.orderId);
    await expect(
      cancelUnpaidOrder(support.db, support.context, paid.orderId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOrders(marketer.db, marketer.context)).rejects.toBeInstanceOf(ForbiddenError);

    // Another store sees none of it.
    const other = await staff(tenantB, "store_owner");
    expect((await listOrders(other.db, other.context, { search: email })).items).toEqual([]);
    await expect(getOrderForStaff(other.db, other.context, paid.orderId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("the order link key", () => {
  it("can be made again from the secret, but not without it", async () => {
    const item = await variant(tenantA, 1000);
    const placed = await placeAndStart(shopA, await guestCart(shopA, item.id));
    expect(orderAccessKey(SECRET, placed.orderId)).toBe(placed.accessKey);
    expect(orderAccessKey("z".repeat(40), placed.orderId)).not.toBe(placed.accessKey);
    await getOrderForShopper(shopA, placed.orderId, {
      accessKey: orderAccessKey(SECRET, placed.orderId),
    });
    await expect(
      getOrderForShopper(shopA, placed.orderId, {
        accessKey: orderAccessKey("z".repeat(40), placed.orderId),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("cash on delivery", () => {
  async function placeCod(
    db: TenantDb,
    token: string,
    phone: string | undefined = "+961 3 123 456",
  ) {
    return placeOrder(db, {
      owner: { token },
      customer: null,
      email: "cod@example.test",
      address: { ...address, country: "LB", city: "Beirut", phone },
      paymentMethod: "cash_on_delivery",
      accessSecret: SECRET,
    });
  }

  it("is confirmed at once, holds stock, and needs a phone number for the courier", async () => {
    const item = await variant(tenantA, 2000, 3);
    await expectOrderError(placeCod(shopA, await guestCart(shopA, item.id), ""), "invalid");
    const placed = await placeCod(shopA, await guestCart(shopA, item.id, 2));
    expect(placed.paymentMethod).toBe("cash_on_delivery");
    expect(placed.order).toMatchObject({
      status: "confirmed",
      paymentMethod: "cash_on_delivery",
      totalAmount: 4000,
    });
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(1);
    // No payment to wait for, and the 30-minute sweep leaves it alone.
    await expectOrderError(startPayment(shopA, provider, placed.orderId, "/x"), "not_payable");
    await expireUnpaidOrders(shopA, new Date(Date.now() + 60 * 60_000));
    const order = await getOrderForShopper(shopA, placed.orderId, { accessKey: placed.accessKey });
    expect(order.status).toBe("confirmed");
    expect(order.payments).toEqual([]);
  });

  it("leaves the shelf when sent, and is paid when the cash is recorded", async () => {
    const owner = await staff(tenantA, "store_owner");
    const item = await variant(tenantA, 1500, 4);
    const placed = await placeCod(shopA, await guestCart(shopA, item.id, 2));
    await expectOrderError(
      recordCashCollected(owner.db, owner.context, placed.orderId),
      "not_allowed",
    );
    await fulfilOrder(owner.db, owner.context, placed.orderId, "Courier Ali");
    let level = await admin.inventoryLevel.findFirstOrThrow({ where: { variantId: item.id } });
    expect(level).toMatchObject({ onHand: 2, reserved: 0 });

    await recordCashCollected(owner.db, owner.context, placed.orderId);
    await expectOrderError(
      recordCashCollected(owner.db, owner.context, placed.orderId),
      "not_allowed",
    );
    await expectOrderError(
      recordDeliveryRefused(owner.db, owner.context, placed.orderId),
      "not_allowed",
    );
    const order = await getOrderForStaff(owner.db, owner.context, placed.orderId);
    expect(order.status).toBe("fulfilled");
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(order.payments).toEqual([
      expect.objectContaining({ status: "succeeded", amount: 3000, methodBrand: "Cash" }),
    ]);
    expect(order.events.map((event) => event.type)).toEqual([
      "placed",
      "fulfilled",
      "cash_collected",
    ]);
    level = await admin.inventoryLevel.findFirstOrThrow({ where: { variantId: item.id } });
    expect(level.onHand).toBe(2);
  });

  it("puts the items back when the parcel is refused, once", async () => {
    const owner = await staff(tenantA, "store_owner");
    const item = await variant(tenantA, 1000, 3);
    const placed = await placeCod(shopA, await guestCart(shopA, item.id, 3));
    await fulfilOrder(owner.db, owner.context, placed.orderId);
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(0);
    await recordDeliveryRefused(owner.db, owner.context, placed.orderId, "Not answering");
    await expectOrderError(
      recordDeliveryRefused(owner.db, owner.context, placed.orderId),
      "not_allowed",
    );
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(3);
    const order = await getOrderForStaff(owner.db, owner.context, placed.orderId);
    expect(order.status).toBe("cancelled");
    const movements = await admin.stockMovement.findMany({
      where: { variantId: item.id },
      orderBy: { createdAt: "asc" },
    });
    expect(movements.map((m) => m.reason)).toEqual(["reservation", "sale", "sale", "return"]);
  });

  it("can be cancelled before sending, returning the held stock", async () => {
    const owner = await staff(tenantA, "store_owner");
    const item = await variant(tenantA, 1000, 2);
    const placed = await placeCod(shopA, await guestCart(shopA, item.id, 2));
    await cancelUnpaidOrder(owner.db, owner.context, placed.orderId);
    expect((await getAvailability(shopA, [item.id])).get(item.id)!.available).toBe(2);
  });

  it("is kept apart from online orders by the rules", async () => {
    const owner = await staff(tenantA, "store_owner");
    const item = await variant(tenantA, 1000);
    const online = await placeAndStart(shopA, await guestCart(shopA, item.id));
    await notify(shopA, online.providerPaymentId, "succeed", 1000);
    await fulfilOrder(owner.db, owner.context, online.orderId);
    // Cash actions do not apply to an order paid online.
    await expectOrderError(
      recordCashCollected(owner.db, owner.context, online.orderId),
      "not_allowed",
    );
    await expectOrderError(
      recordDeliveryRefused(owner.db, owner.context, online.orderId),
      "not_allowed",
    );
    // The database refuses to switch an order's payment method, or give an online order the cash status.
    await expect(
      admin.order.update({
        where: { id: online.orderId },
        data: { paymentMethod: "cash_on_delivery" },
      }),
    ).rejects.toThrow();
    const cod = await placeCod(shopA, await guestCart(shopA, item.id));
    await expect(
      admin.order.update({ where: { id: cod.orderId }, data: { status: "paid" } }),
    ).rejects.toThrow();
  });
});
