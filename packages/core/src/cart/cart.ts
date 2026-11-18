import { createHash, randomBytes } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import type { TenantDb } from "../access/tenant-db";
import { availabilityIn } from "../inventory/stock";
import { ASSET_SELECT, toStoredImage, type StoredImage } from "../media/assets";

// The shopping cart. A visitor needs no account: their cart is found by a
// random token that the web app keeps in an HttpOnly cookie. Rules that
// protect it:
//
// - Only a hash of the token is stored, and a guest cart is only ever looked
//   up by that hash, so a visitor can reach their own cart and no other.
// - A signed-in customer's cart is found by their customer ID (which comes
//   from their session, never from a form) and follows them between devices.
//   Once a cart belongs to a customer its token no longer opens it, so a
//   browser that was signed out cannot reach it.
// - Everything runs inside the store's tenant (Row-Level Security), so a
//   token from one store opens nothing in another.
// - Prices are read from the catalog every time. Nothing the browser sends
//   can set a price, and totals are computed here in whole minor units.
// - Only variants a shopper could see on the storefront can be added.
// - For items whose stock is counted, the cart never holds more than can be
//   had right now. It does not hold stock: that happens at checkout.

import { CART_LIFETIME_DAYS, MAX_CART_LINES, MAX_LINE_QUANTITY } from "./limits";

export { CART_LIFETIME_DAYS, MAX_CART_LINES, MAX_LINE_QUANTITY };

export type CartErrorCode =
  | "unavailable"
  | "invalid_quantity"
  | "cart_full"
  | "not_found"
  | "out_of_stock"
  | "not_enough_stock";

const MESSAGES: Record<CartErrorCode, string> = {
  unavailable: "This item is not available.",
  out_of_stock: "This item is out of stock.",
  not_enough_stock: "There are not that many of this item left.",
  invalid_quantity: `Choose a quantity from 1 to ${MAX_LINE_QUANTITY}.`,
  cart_full: `A cart can hold ${MAX_CART_LINES} different items at most.`,
  not_found: "That item is no longer in your cart.",
};

/** A cart request refused for a reason the shopper can understand. The message is safe to show. */
export class CartError extends Error {
  constructor(
    readonly code: CartErrorCode,
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = "CartError";
  }
}

/** Refuses a quantity beyond what can be had; says how many there are. */
function assertInStock(
  stock: { tracked: boolean; available: number | null } | undefined,
  wanted: number,
) {
  if (!stock?.tracked) return;
  const available = stock.available ?? 0;
  if (available <= 0) throw new CartError("out_of_stock");
  if (wanted > available) {
    throw new CartError(
      "not_enough_stock",
      available === 1 ? "Only 1 of this item is left." : `Only ${available} of this item are left.`,
    );
  }
}

// --- Token -------------------------------------------------------------------

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 256 random bits. Unguessable, so knowing it is what proves a cart is yours. */
export function newCartToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isCartToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const expiry = () => new Date(Date.now() + CART_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

// --- What a cart looks like --------------------------------------------------

export interface CartLine {
  id: string;
  variantId: string;
  productName: string;
  productSlug: string;
  sku: string;
  color: string | null;
  size: string | null;
  quantity: number;
  /** The current price of one, in minor units. */
  unitPriceAmount: number;
  /** The regular price when the variant is on sale; null otherwise. */
  regularPriceAmount: number | null;
  lineTotalAmount: number;
  /** False when the item is no longer for sale or is out of stock. Not counted in the total. */
  available: boolean;
  /** True when it is for sale but none are left right now. */
  outOfStock: boolean;
  /** How many can be had, when stock is counted and fewer than the cart holds; otherwise null. */
  onlyLeft: number | null;
  /** Set when the price is different from when the item was added. */
  priceWas: number | null;
  image: (StoredImage & { altText: string }) | null;
}

export interface CartView {
  lines: CartLine[];
  /** Number of things in the cart (quantities added up), available or not. */
  itemCount: number;
  /** Total of the available lines, before shipping, tax and discounts. */
  subtotalAmount: number;
  currency: string | null;
  hasUnavailable: boolean;
}

export const EMPTY_CART: CartView = {
  lines: [],
  itemCount: 0,
  subtotalAmount: 0,
  currency: null,
  hasUnavailable: false,
};

/**
 * Who is asking for a cart: a signed-in customer (by ID, from their session),
 * a guest (by cookie token), or nobody yet. A bare token string is accepted
 * as shorthand for a guest.
 */
export type CartOwner =
  { token?: string | null; customerId?: string | null } | string | null | undefined;

const normalizeOwner = (owner: CartOwner) =>
  typeof owner === "string" || owner === null || owner === undefined
    ? { token: owner ?? null, customerId: null }
    : { token: owner.token ?? null, customerId: owner.customerId ?? null };

async function findCart(tx: AppTransaction, owner: CartOwner) {
  const { token, customerId } = normalizeOwner(owner);
  const open = { status: "active" as const, expiresAt: { gt: new Date() } };
  const select = { id: true, currency: true, customerId: true } as const;
  if (customerId) {
    return tx.cart.findFirst({
      where: { customerId, ...open },
      orderBy: { updatedAt: "desc" },
      select,
    });
  }
  if (!isCartToken(token)) return null;
  // A cart that belongs to a customer is not a guest cart any more.
  return tx.cart.findFirst({
    where: { tokenHash: hashToken(token), customerId: null, ...open },
    select,
  });
}

async function loadView(
  tx: AppTransaction,
  cart: { id: string; currency: string },
): Promise<CartView> {
  const items = await tx.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      quantity: true,
      unitPriceAmount: true,
      variant: {
        select: {
          id: true,
          sku: true,
          color: true,
          size: true,
          status: true,
          priceAmount: true,
          discountPriceAmount: true,
          currency: true,
          product: {
            select: {
              name: true,
              slug: true,
              status: true,
              images: {
                select: { altText: true, variantId: true, asset: { select: ASSET_SELECT } },
                orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              },
            },
          },
        },
      },
    },
  });

  const stock = await availabilityIn(
    tx,
    items.map((item) => item.variant.id),
  );

  const lines = items.map((item): CartLine => {
    const { variant } = item;
    const { product } = variant;
    const current = variant.discountPriceAmount ?? variant.priceAmount;
    const forSale =
      variant.status === "active" &&
      product.status === "active" &&
      variant.currency === cart.currency;
    const level = stock.get(variant.id);
    const left = level?.tracked ? Math.max(0, level.available ?? 0) : null;
    const outOfStock = forSale && left === 0;
    const available = forSale && !outOfStock;
    // The variant's own picture if it has one, else a general one, else any.
    const image =
      product.images.find((candidate) => candidate.variantId === variant.id) ??
      product.images.find((candidate) => candidate.variantId === null) ??
      product.images[0];
    return {
      id: item.id,
      variantId: variant.id,
      productName: product.name,
      productSlug: product.slug,
      sku: variant.sku,
      color: variant.color,
      size: variant.size,
      quantity: item.quantity,
      unitPriceAmount: current,
      regularPriceAmount: variant.discountPriceAmount !== null ? variant.priceAmount : null,
      lineTotalAmount: current * item.quantity,
      available,
      outOfStock,
      onlyLeft: available && left !== null && left < item.quantity ? left : null,
      priceWas: available && item.unitPriceAmount !== current ? item.unitPriceAmount : null,
      image: image ? { ...toStoredImage(image.asset), altText: image.altText } : null,
    };
  });

  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalAmount: lines
      .filter((line) => line.available)
      .reduce((sum, line) => sum + line.lineTotalAmount, 0),
    currency: cart.currency,
    hasUnavailable: lines.some((line) => !line.available),
  };
}

// --- Reading -----------------------------------------------------------------

/** The cart this token opens. A missing, malformed, expired or foreign token gives an empty cart. */
export async function getCart(db: TenantDb, owner: CartOwner): Promise<CartView> {
  const { token, customerId } = normalizeOwner(owner);
  if (!customerId && !isCartToken(token)) return EMPTY_CART;
  return db.run(async (tx) => {
    const cart = await findCart(tx, owner);
    return cart ? loadView(tx, cart) : EMPTY_CART;
  });
}

/** How many things are in the cart, for the header. One small query. */
export async function getCartCount(db: TenantDb, owner: CartOwner): Promise<number> {
  const { token, customerId } = normalizeOwner(owner);
  if (!customerId && !isCartToken(token)) return 0;
  return db.run(async (tx) => {
    const cart = await findCart(tx, owner);
    if (!cart) return 0;
    const total = await tx.cartItem.aggregate({
      where: { cartId: cart.id },
      _sum: { quantity: true },
    });
    return total._sum.quantity ?? 0;
  });
}

// --- Changing ----------------------------------------------------------------

function assertQuantity(quantity: unknown, min: number): asserts quantity is number {
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < min ||
    quantity > MAX_LINE_QUANTITY
  ) {
    throw new CartError("invalid_quantity");
  }
}

export interface AddToCartResult {
  /** The token of the guest cart that now holds the item; null for a customer's cart. */
  token: string | null;
  /** True when a new cart was started and the token must be given to the browser. */
  tokenIsNew: boolean;
  /** True when the quantity was held at the most allowed for one item. */
  capped: boolean;
  cart: CartView;
}

/**
 * Adds a variant to the visitor's cart, starting a cart if they have none.
 * Only a variant that is for sale in a published product of this store can
 * be added; anything else is "unavailable", whatever the reason.
 */
export async function addToCart(
  db: TenantDb,
  owner: CartOwner,
  input: { variantId: string; quantity: number },
): Promise<AddToCartResult> {
  assertQuantity(input.quantity, 1);
  if (typeof input.variantId !== "string" || !UUID.test(input.variantId)) {
    throw new CartError("unavailable");
  }

  return db.run(async (tx) => {
    const variant = await tx.productVariant.findFirst({
      where: { id: input.variantId, status: "active", product: { status: "active" } },
      select: {
        id: true,
        productId: true,
        priceAmount: true,
        discountPriceAmount: true,
        currency: true,
      },
    });
    if (!variant) throw new CartError("unavailable");
    const price = variant.discountPriceAmount ?? variant.priceAmount;

    const { token, customerId } = normalizeOwner(owner);
    let cart = await findCart(tx, owner);
    let cartToken: string | null = customerId ? null : token;
    const tokenIsNew = cart === null && !customerId;
    if (!cart) {
      // Every cart has a token hash; a customer's cart is never opened by it.
      const fresh = newCartToken();
      if (!customerId) cartToken = fresh;
      cart = await tx.cart.create({
        data: {
          tenantId: db.tenantId,
          tokenHash: hashToken(fresh),
          customerId,
          currency: variant.currency,
          expiresAt: expiry(),
        },
        select: { id: true, currency: true, customerId: true },
      });
    }
    // One currency per cart (and per store today).
    if (cart.currency !== variant.currency) throw new CartError("unavailable");

    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      select: { id: true, quantity: true },
    });
    const stock = (await availabilityIn(tx, [variant.id])).get(variant.id);
    let capped = false;
    if (existing) {
      const quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + input.quantity);
      capped = quantity < existing.quantity + input.quantity;
      assertInStock(stock, quantity);
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity, unitPriceAmount: price },
      });
    } else {
      assertInStock(stock, input.quantity);
      if ((await tx.cartItem.count({ where: { cartId: cart.id } })) >= MAX_CART_LINES) {
        throw new CartError("cart_full");
      }
      await tx.cartItem.create({
        data: {
          tenantId: db.tenantId,
          cartId: cart.id,
          variantId: variant.id,
          quantity: input.quantity,
          unitPriceAmount: price,
        },
      });
    }
    await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: expiry() } });
    // Counted for the reports (7.4): which product, nothing about who.
    await tx.analyticsEvent.create({
      data: { tenantId: db.tenantId, name: "add_to_cart", productId: variant.productId },
      select: { id: true },
    });

    return { token: cartToken, tokenIsNew, capped, cart: await loadView(tx, cart) };
  });
}

/**
 * Sets the quantity of one line of the visitor's own cart; zero removes it.
 * The line is looked up inside the cart the token opens, so a line ID from
 * someone else's cart is simply "not found".
 */
export async function setCartItemQuantity(
  db: TenantDb,
  owner: CartOwner,
  itemId: string,
  quantity: number,
): Promise<CartView> {
  assertQuantity(quantity, 0);
  if (typeof itemId !== "string" || !UUID.test(itemId)) throw new CartError("not_found");

  return db.run(async (tx) => {
    const cart = await findCart(tx, owner);
    if (!cart) throw new CartError("not_found");
    const item = await tx.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      select: {
        id: true,
        quantity: true,
        variant: { select: { id: true, priceAmount: true, discountPriceAmount: true } },
      },
    });
    if (!item) throw new CartError("not_found");
    // Lowering a quantity is always allowed; raising it needs the stock.
    if (quantity > item.quantity) {
      assertInStock((await availabilityIn(tx, [item.variant.id])).get(item.variant.id), quantity);
    }

    if (quantity === 0) {
      await tx.cartItem.delete({ where: { id: item.id } });
    } else {
      await tx.cartItem.update({
        where: { id: item.id },
        data: {
          quantity,
          // The shopper has now seen the current price on the cart page.
          unitPriceAmount: item.variant.discountPriceAmount ?? item.variant.priceAmount,
        },
      });
    }
    await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: expiry() } });
    return loadView(tx, cart);
  });
}

export function removeCartItem(db: TenantDb, owner: CartOwner, itemId: string): Promise<CartView> {
  return setCartItemQuantity(db, owner, itemId, 0);
}

/**
 * Called when a customer signs in: whatever they put in the cart as a guest
 * on this browser becomes theirs. If they already had a cart (from another
 * device), the guest items are added to it, each held at the usual limit,
 * and the guest cart is removed. A guest cart is only ever claimed by the
 * token that opens it.
 */
export async function claimCartForCustomer(
  db: TenantDb,
  token: string | null | undefined,
  customerId: string,
): Promise<void> {
  if (!UUID.test(customerId)) return;
  await db.run(async (tx) => {
    const guest = await findCart(tx, { token });
    if (!guest) return;
    const mine = await findCart(tx, { customerId });
    if (!mine) {
      await tx.cart.update({
        where: { id: guest.id },
        data: { customerId, expiresAt: expiry() },
      });
      return;
    }
    if (mine.currency === guest.currency) {
      const [mineItems, guestItems] = await Promise.all([
        tx.cartItem.findMany({
          where: { cartId: mine.id },
          select: { id: true, variantId: true, quantity: true },
        }),
        tx.cartItem.findMany({
          where: { cartId: guest.id },
          select: { variantId: true, quantity: true, unitPriceAmount: true },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const byVariant = new Map(mineItems.map((item) => [item.variantId, item]));
      let lines = mineItems.length;
      for (const item of guestItems) {
        const existing = byVariant.get(item.variantId);
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + item.quantity) },
          });
        } else if (lines < MAX_CART_LINES) {
          await tx.cartItem.create({
            data: {
              tenantId: db.tenantId,
              cartId: mine.id,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPriceAmount: item.unitPriceAmount,
            },
          });
          lines += 1;
        }
      }
    }
    await tx.cart.delete({ where: { id: guest.id } });
    await tx.cart.update({ where: { id: mine.id }, data: { expiresAt: expiry() } });
  });
}

// --- For checkout ------------------------------------------------------------

/**
 * The cart a checkout is for, read inside the checkout's own transaction so
 * the order is built from exactly what is shown. Null when there is no cart.
 */
export async function checkoutCartIn(
  tx: AppTransaction,
  owner: CartOwner,
): Promise<{ id: string; view: CartView } | null> {
  const cart = await findCart(tx, owner);
  if (!cart) return null;
  return { id: cart.id, view: await loadView(tx, cart) };
}

/** Closes a cart once its order is paid: it no longer opens for anyone. */
export async function convertCartIn(tx: AppTransaction, cartId: string): Promise<void> {
  await tx.cart.updateMany({
    where: { id: cartId, status: "active" },
    data: { status: "converted" },
  });
}
