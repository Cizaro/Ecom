import { createHash, randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import {
  addToCart,
  CartError,
  getCart,
  getCartCount,
  isCartToken,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  removeCartItem,
  setCartItemQuantity,
  type CartErrorCode,
} from "./cart";

// The cart against the real (test) database on the runtime connection, so
// Row-Level Security is in force. Catalog data is written with the admin
// connection; every cart operation goes through the services.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];

let shopA: TenantDb;
let shopB: TenantDb;
let tenantA: string;
let tenantB: string;

async function createTenant(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Cart ${label} ${run}`, slug: `cart-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function variant(
  tenantId: string,
  options: {
    price?: number;
    sale?: number;
    productStatus?: "draft" | "active" | "archived";
    status?: "active" | "inactive";
    currency?: string;
  } = {},
) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: {
      tenantId,
      name: `Thing ${tag}`,
      slug: `thing-${tag}`,
      status: options.productStatus ?? "active",
    },
  });
  return admin.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      sku: `SKU-${tag}`,
      color: "Black",
      priceAmount: options.price ?? 2500,
      discountPriceAmount: options.sale ?? null,
      costAmount: 999,
      currency: options.currency ?? "USD",
      status: options.status ?? "active",
    },
  });
}

async function expectCartError(work: Promise<unknown>, code: CartErrorCode) {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected CartError ${code}`).toBeInstanceOf(CartError);
  expect((error as CartError).code).toBe(code);
}

beforeAll(async () => {
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  shopA = createTenantDb(app, { tenantId: tenantA });
  shopB = createTenantDb(app, { tenantId: tenantB });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await disconnectDatabase();
});

describe("adding to a cart", () => {
  it("starts a cart, hands back a token, and stores only the token's hash", async () => {
    const item = await variant(tenantA, { price: 2500 });
    const added = await addToCart(shopA, null, { variantId: item.id, quantity: 2 });

    expect(added.tokenIsNew).toBe(true);
    expect(isCartToken(added.token)).toBe(true);
    expect(added.cart).toMatchObject({ itemCount: 2, subtotalAmount: 5000, currency: "USD" });
    expect(added.cart.lines[0]).toMatchObject({
      variantId: item.id,
      quantity: 2,
      unitPriceAmount: 2500,
      lineTotalAmount: 5000,
      available: true,
      priceWas: null,
    });

    const rows = await admin.cart.findMany({ where: { tenantId: tenantA } });
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(added.token);
    expect(stored).toContain(createHash("sha256").update(added.token).digest("hex"));
    // Nothing about cost reaches the cart.
    expect(JSON.stringify(added.cart)).not.toMatch(/cost|999/i);
  });

  it("adds to the same line and holds the quantity at the limit", async () => {
    const item = await variant(tenantA);
    const first = await addToCart(shopA, null, { variantId: item.id, quantity: 4 });
    const second = await addToCart(shopA, first.token, { variantId: item.id, quantity: 4 });
    expect(second.tokenIsNew).toBe(false);
    expect(second.token).toBe(first.token);
    expect(second.capped).toBe(false);
    expect(second.cart.lines).toHaveLength(1);
    expect(second.cart.lines[0]!.quantity).toBe(8);

    const third = await addToCart(shopA, first.token, { variantId: item.id, quantity: 5 });
    expect(third.capped).toBe(true);
    expect(third.cart.lines[0]!.quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("uses the sale price when there is one", async () => {
    const item = await variant(tenantA, { price: 5000, sale: 4000 });
    const { cart } = await addToCart(shopA, null, { variantId: item.id, quantity: 3 });
    expect(cart.lines[0]).toMatchObject({
      unitPriceAmount: 4000,
      regularPriceAmount: 5000,
      lineTotalAmount: 12000,
    });
    expect(cart.subtotalAmount).toBe(12000);
  });

  it("refuses quantities that are not whole numbers in range", async () => {
    const item = await variant(tenantA);
    for (const quantity of [0, -1, 1.5, MAX_LINE_QUANTITY + 1, 1e9, Number.NaN, "2" as never]) {
      await expectCartError(
        addToCart(shopA, null, { variantId: item.id, quantity }),
        "invalid_quantity",
      );
    }
    expect(await admin.cartItem.count({ where: { variantId: item.id } })).toBe(0);
  });

  it("refuses anything a shopper could not see on the storefront", async () => {
    const draft = await variant(tenantA, { productStatus: "draft" });
    const archived = await variant(tenantA, { productStatus: "archived" });
    const inactive = await variant(tenantA, { status: "inactive" });
    const otherStore = await variant(tenantB);
    const cartsBefore = await admin.cart.count({ where: { tenantId: tenantA } });

    for (const id of [draft.id, archived.id, inactive.id, otherStore.id, randomUUID()]) {
      await expectCartError(addToCart(shopA, null, { variantId: id, quantity: 1 }), "unavailable");
    }
    for (const id of ["", "not-an-id", "' OR 1=1 --", null as never, {} as never]) {
      await expectCartError(addToCart(shopA, null, { variantId: id, quantity: 1 }), "unavailable");
    }
    // A refused request leaves no empty cart behind.
    expect(await admin.cart.count({ where: { tenantId: tenantA } })).toBe(cartsBefore);
  });

  it("keeps one currency per cart", async () => {
    const dollars = await variant(tenantA);
    const yen = await variant(tenantA, { currency: "JPY", price: 3000 });
    const { token } = await addToCart(shopA, null, { variantId: dollars.id, quantity: 1 });
    await expectCartError(
      addToCart(shopA, token, { variantId: yen.id, quantity: 1 }),
      "unavailable",
    );
  });

  it(`holds ${MAX_CART_LINES} different items and no more`, async () => {
    const tag = randomUUID().slice(0, 8);
    const product = await admin.product.create({
      data: { tenantId: tenantA, name: `Many ${tag}`, slug: `many-${tag}`, status: "active" },
    });
    await admin.productVariant.createMany({
      data: Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => ({
        tenantId: tenantA,
        productId: product.id,
        sku: `MANY-${tag}-${index}`,
        priceAmount: 100,
        currency: "USD",
      })),
    });
    const variants = await admin.productVariant.findMany({ where: { productId: product.id } });
    let token: string | null = null;
    for (const item of variants.slice(0, MAX_CART_LINES)) {
      token = (await addToCart(shopA, token, { variantId: item.id, quantity: 1 })).token;
    }
    await expectCartError(
      addToCart(shopA, token, { variantId: variants[MAX_CART_LINES]!.id, quantity: 1 }),
      "cart_full",
    );
    expect(await getCartCount(shopA, token)).toBe(MAX_CART_LINES);
  }, 60_000);
});

describe("whose cart it is", () => {
  it("opens only with its own token", async () => {
    const item = await variant(tenantA);
    const mine = await addToCart(shopA, null, { variantId: item.id, quantity: 2 });
    const theirs = await addToCart(shopA, null, { variantId: item.id, quantity: 1 });
    expect(theirs.token).not.toBe(mine.token);

    expect((await getCart(shopA, mine.token)).itemCount).toBe(2);
    expect((await getCart(shopA, theirs.token)).itemCount).toBe(1);

    // No token, a malformed one, a well-formed wrong one, or the stored hash: nothing.
    const hash = createHash("sha256").update(mine.token).digest("hex");
    for (const token of [null, undefined, "", "abc", "x".repeat(43), hash, `${mine.token}x`]) {
      expect((await getCart(shopA, token)).lines).toEqual([]);
      expect(await getCartCount(shopA, token)).toBe(0);
    }
  });

  it("cannot be changed through another visitor's token, even with the right line ID", async () => {
    const item = await variant(tenantA);
    const mine = await addToCart(shopA, null, { variantId: item.id, quantity: 2 });
    const theirs = await addToCart(shopA, null, { variantId: item.id, quantity: 1 });
    const myLine = mine.cart.lines[0]!.id;

    await expectCartError(setCartItemQuantity(shopA, theirs.token, myLine, 5), "not_found");
    await expectCartError(removeCartItem(shopA, theirs.token, myLine), "not_found");
    await expectCartError(setCartItemQuantity(shopA, null, myLine, 5), "not_found");
    await expectCartError(setCartItemQuantity(shopA, mine.token, "not-an-id", 1), "not_found");

    const after = await getCart(shopA, mine.token);
    expect(after.lines[0]).toMatchObject({ id: myLine, quantity: 2 });
  });

  it("is invisible from another store, token and all", async () => {
    const item = await variant(tenantA);
    const mine = await addToCart(shopA, null, { variantId: item.id, quantity: 2 });
    const line = mine.cart.lines[0]!.id;

    expect((await getCart(shopB, mine.token)).lines).toEqual([]);
    expect(await getCartCount(shopB, mine.token)).toBe(0);
    await expectCartError(setCartItemQuantity(shopB, mine.token, line, 1), "not_found");

    // Using the token in the other store starts a separate cart there.
    const theirItem = await variant(tenantB);
    const elsewhere = await addToCart(shopB, mine.token, { variantId: theirItem.id, quantity: 1 });
    expect(elsewhere.tokenIsNew).toBe(true);
    expect(elsewhere.token).not.toBe(mine.token);
    expect((await getCart(shopA, mine.token)).itemCount).toBe(2);

    // Underneath the services, the database itself refuses.
    const asOther = { tenantId: tenantB };
    expect(await withTenant(app, asOther, (tx) => tx.cartItem.count({ where: { id: line } }))).toBe(
      0,
    );
    expect(
      await withTenant(app, asOther, (tx) => tx.cartItem.deleteMany({ where: { id: line } })),
    ).toEqual({ count: 0 });
    const theirCart = await admin.cart.findFirstOrThrow({ where: { tenantId: tenantB } });
    // Store B cannot put store A's variant in its own cart.
    await expect(
      withTenant(app, asOther, (tx) =>
        tx.cartItem.create({
          data: {
            tenantId: tenantB,
            cartId: theirCart.id,
            variantId: item.id,
            quantity: 1,
            unitPriceAmount: 1,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("changing a cart", () => {
  it("changes a quantity, removes with zero, and recomputes the total", async () => {
    const first = await variant(tenantA, { price: 1000 });
    const second = await variant(tenantA, { price: 250 });
    const { token } = await addToCart(shopA, null, { variantId: first.id, quantity: 1 });
    const cart = (await addToCart(shopA, token, { variantId: second.id, quantity: 4 })).cart;
    expect(cart.subtotalAmount).toBe(2000);
    const [lineOne, lineTwo] = cart.lines;

    const changed = await setCartItemQuantity(shopA, token, lineOne!.id, 3);
    expect(changed).toMatchObject({ itemCount: 7, subtotalAmount: 4000 });

    const removed = await removeCartItem(shopA, token, lineTwo!.id);
    expect(removed.lines.map((line) => line.id)).toEqual([lineOne!.id]);
    expect(removed).toMatchObject({ itemCount: 3, subtotalAmount: 3000 });

    for (const quantity of [-1, 2.5, MAX_LINE_QUANTITY + 1]) {
      await expectCartError(
        setCartItemQuantity(shopA, token, lineOne!.id, quantity),
        "invalid_quantity",
      );
    }
    await expectCartError(removeCartItem(shopA, token, lineTwo!.id), "not_found");
  });

  it("always charges the current price and says when it has changed", async () => {
    const item = await variant(tenantA, { price: 2000 });
    const { token, cart } = await addToCart(shopA, null, { variantId: item.id, quantity: 2 });
    const line = cart.lines[0]!.id;

    await admin.productVariant.update({ where: { id: item.id }, data: { priceAmount: 2600 } });
    const afterRise = await getCart(shopA, token);
    expect(afterRise.lines[0]).toMatchObject({
      unitPriceAmount: 2600,
      lineTotalAmount: 5200,
      priceWas: 2000,
    });
    expect(afterRise.subtotalAmount).toBe(5200);

    // Once the shopper acts on the line, the notice has done its job.
    const acknowledged = await setCartItemQuantity(shopA, token, line, 2);
    expect(acknowledged.lines[0]!.priceWas).toBeNull();
    expect(acknowledged.subtotalAmount).toBe(5200);
  });

  it("flags items no longer for sale and leaves them out of the total", async () => {
    const stays = await variant(tenantA, { price: 1000 });
    const goes = await variant(tenantA, { price: 5000 });
    const { token } = await addToCart(shopA, null, { variantId: stays.id, quantity: 1 });
    await addToCart(shopA, token, { variantId: goes.id, quantity: 1 });

    await admin.product.update({ where: { id: goes.productId }, data: { status: "draft" } });
    const cart = await getCart(shopA, token);
    expect(cart.hasUnavailable).toBe(true);
    expect(cart.subtotalAmount).toBe(1000);
    const gone = cart.lines.find((line) => line.variantId === goes.id)!;
    expect(gone.available).toBe(false);
    // It can still be removed.
    const cleaned = await removeCartItem(shopA, token, gone.id);
    expect(cleaned.hasUnavailable).toBe(false);
    expect(cleaned.lines).toHaveLength(1);
  });

  it("treats an expired cart as empty and starts a fresh one", async () => {
    const item = await variant(tenantA);
    const old = await addToCart(shopA, null, { variantId: item.id, quantity: 1 });
    await admin.cart.updateMany({
      where: { tokenHash: createHash("sha256").update(old.token).digest("hex") },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getCart(shopA, old.token)).lines).toEqual([]);
    const fresh = await addToCart(shopA, old.token, { variantId: item.id, quantity: 1 });
    expect(fresh.tokenIsNew).toBe(true);
    expect(fresh.token).not.toBe(old.token);
    expect(fresh.cart.itemCount).toBe(1);
  });

  it("enforces the quantity rule in the database too", async () => {
    const item = await variant(tenantA);
    const { cart } = await addToCart(shopA, null, { variantId: item.id, quantity: 1 });
    await expect(
      admin.cartItem.update({ where: { id: cart.lines[0]!.id }, data: { quantity: 0 } }),
    ).rejects.toThrow();
    await expect(
      admin.cartItem.update({ where: { id: cart.lines[0]!.id }, data: { quantity: 1000 } }),
    ).rejects.toThrow();
  });
});
