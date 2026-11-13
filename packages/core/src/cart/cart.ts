import { createHash, randomBytes } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import type { TenantDb } from "../access/tenant-db";
import { ASSET_SELECT, toStoredImage, type StoredImage } from "../media/assets";

// The shopping cart. A visitor needs no account: their cart is found by a
// random token that the web app keeps in an HttpOnly cookie. Rules that
// protect it:
//
// - Only a hash of the token is stored, and a cart is only ever looked up by
//   that hash, so a visitor can reach their own cart and no other.
// - Everything runs inside the store's tenant (Row-Level Security), so a
//   token from one store opens nothing in another.
// - Prices are read from the catalog every time. Nothing the browser sends
//   can set a price, and totals are computed here in whole minor units.
// - Only variants a shopper could see on the storefront can be added.

export const MAX_LINE_QUANTITY = 10;
export const MAX_CART_LINES = 50;
export const CART_LIFETIME_DAYS = 30;

export type CartErrorCode = "unavailable" | "invalid_quantity" | "cart_full" | "not_found";

const MESSAGES: Record<CartErrorCode, string> = {
  unavailable: "This item is not available.",
  invalid_quantity: `Choose a quantity from 1 to ${MAX_LINE_QUANTITY}.`,
  cart_full: `A cart can hold ${MAX_CART_LINES} different items at most.`,
  not_found: "That item is no longer in your cart.",
};

/** A cart request refused for a reason the shopper can understand. The message is safe to show. */
export class CartError extends Error {
  constructor(readonly code: CartErrorCode) {
    super(MESSAGES[code]);
    this.name = "CartError";
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
  /** False when the product or variant is no longer for sale. Not counted in the total. */
  available: boolean;
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

async function findCart(tx: AppTransaction, token: string | null | undefined) {
  if (!isCartToken(token)) return null;
  return tx.cart.findFirst({
    where: { tokenHash: hashToken(token), status: "active", expiresAt: { gt: new Date() } },
    select: { id: true, currency: true },
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

  const lines = items.map((item): CartLine => {
    const { variant } = item;
    const { product } = variant;
    const current = variant.discountPriceAmount ?? variant.priceAmount;
    const available =
      variant.status === "active" &&
      product.status === "active" &&
      variant.currency === cart.currency;
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
export async function getCart(db: TenantDb, token: string | null | undefined): Promise<CartView> {
  if (!isCartToken(token)) return EMPTY_CART;
  return db.run(async (tx) => {
    const cart = await findCart(tx, token);
    return cart ? loadView(tx, cart) : EMPTY_CART;
  });
}

/** How many things are in the cart, for the header. One small query. */
export async function getCartCount(
  db: TenantDb,
  token: string | null | undefined,
): Promise<number> {
  if (!isCartToken(token)) return 0;
  return db.run(async (tx) => {
    const cart = await findCart(tx, token);
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
  /** The token of the cart that now holds the item. */
  token: string;
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
  token: string | null | undefined,
  input: { variantId: string; quantity: number },
): Promise<AddToCartResult> {
  assertQuantity(input.quantity, 1);
  if (typeof input.variantId !== "string" || !UUID.test(input.variantId)) {
    throw new CartError("unavailable");
  }

  return db.run(async (tx) => {
    const variant = await tx.productVariant.findFirst({
      where: { id: input.variantId, status: "active", product: { status: "active" } },
      select: { id: true, priceAmount: true, discountPriceAmount: true, currency: true },
    });
    if (!variant) throw new CartError("unavailable");
    const price = variant.discountPriceAmount ?? variant.priceAmount;

    let cart = await findCart(tx, token);
    let cartToken = token as string;
    const tokenIsNew = cart === null;
    if (!cart) {
      cartToken = newCartToken();
      cart = await tx.cart.create({
        data: {
          tenantId: db.tenantId,
          tokenHash: hashToken(cartToken),
          currency: variant.currency,
          expiresAt: expiry(),
        },
        select: { id: true, currency: true },
      });
    }
    // One currency per cart (and per store today).
    if (cart.currency !== variant.currency) throw new CartError("unavailable");

    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      select: { id: true, quantity: true },
    });
    let capped = false;
    if (existing) {
      const quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + input.quantity);
      capped = quantity < existing.quantity + input.quantity;
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity, unitPriceAmount: price },
      });
    } else {
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
  token: string | null | undefined,
  itemId: string,
  quantity: number,
): Promise<CartView> {
  assertQuantity(quantity, 0);
  if (typeof itemId !== "string" || !UUID.test(itemId)) throw new CartError("not_found");

  return db.run(async (tx) => {
    const cart = await findCart(tx, token);
    if (!cart) throw new CartError("not_found");
    const item = await tx.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      select: {
        id: true,
        variant: { select: { priceAmount: true, discountPriceAmount: true } },
      },
    });
    if (!item) throw new CartError("not_found");

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

export function removeCartItem(
  db: TenantDb,
  token: string | null | undefined,
  itemId: string,
): Promise<CartView> {
  return setCartItemQuantity(db, token, itemId, 0);
}
