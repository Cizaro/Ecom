import { createHash } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { isUniqueViolation } from "../catalog/errors";
import { formatMoney, moneyToInput, parseMoney } from "../catalog/money";
import { countryName, isCountryCode } from "../customers/countries";

// Delivery areas and tax. Rules this file keeps:
//
// - Staff set the delivery areas and their prices; nothing here invents a
//   fee, a delivery time or a tax rate. A store with no delivery areas
//   charges no delivery, and one with a 0% rate shows no tax.
// - At checkout the shopper picks an area from the store's list (each shown
//   with its price). The server works the fee and tax out again from the
//   database when the order is placed; amounts sent by the browser are
//   never used.
// - Everything is done inside the store's own tenant.

export const MAX_ZONES = 50;
/** 50%: higher is almost certainly a typing mistake. */
export const MAX_TAX_RATE_BASIS_POINTS = 5000;

export type ShippingErrorCode = "invalid";

export class ShippingError extends Error {
  constructor(
    readonly code: ShippingErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ShippingError";
  }
}

export interface ShippingZoneView {
  id: string;
  name: string;
  countries: string[];
  rateAmount: number;
  freeOverAmount: number | null;
  currency: string;
  isActive: boolean;
  position: number;
}

export interface TaxSettings {
  /** Hundredths of a percent: 1100 is 11%. */
  rateBasisPoints: number;
  included: boolean;
  label: string;
}

export const NO_TAX: TaxSettings = { rateBasisPoints: 0, included: true, label: "VAT" };

const ZONE_SELECT = {
  id: true,
  name: true,
  countries: true,
  rateAmount: true,
  freeOverAmount: true,
  currency: true,
  isActive: true,
  position: true,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Pricing (pure) ------------------------------------------------------------

/** The delivery fee for an area, given what the items come to. */
export function deliveryFee(
  zone: Pick<ShippingZoneView, "rateAmount" | "freeOverAmount">,
  subtotalAmount: number,
): number {
  if (zone.freeOverAmount !== null && subtotalAmount >= zone.freeOverAmount) return 0;
  return zone.rateAmount;
}

/** Rounds a / b to the nearest whole number, halves up (all values are non-negative). */
const roundDiv = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

export interface OrderPricing {
  subtotalAmount: number;
  shippingAmount: number;
  /** Tax added on top (0 when prices include it). */
  taxAmount: number;
  /** Tax already inside the prices, shown for information. */
  taxIncludedAmount: number;
  totalAmount: number;
}

/**
 * What an order costs: items, delivery and tax. Tax applies to the items and
 * the delivery together. When prices include tax, the total is unchanged and
 * the tax inside it is worked out for display.
 */
export function priceOrder(
  subtotalAmount: number,
  zone: Pick<ShippingZoneView, "rateAmount" | "freeOverAmount"> | null,
  tax: TaxSettings,
): OrderPricing {
  const shippingAmount = zone ? deliveryFee(zone, subtotalAmount) : 0;
  const taxable = subtotalAmount + shippingAmount;
  const rate = tax.rateBasisPoints;
  if (rate === 0) {
    return {
      subtotalAmount,
      shippingAmount,
      taxAmount: 0,
      taxIncludedAmount: 0,
      totalAmount: taxable,
    };
  }
  if (tax.included) {
    return {
      subtotalAmount,
      shippingAmount,
      taxAmount: 0,
      taxIncludedAmount: roundDiv(taxable * rate, 10_000 + rate),
      totalAmount: taxable,
    };
  }
  const taxAmount = roundDiv(taxable * rate, 10_000);
  return {
    subtotalAmount,
    shippingAmount,
    taxAmount,
    taxIncludedAmount: 0,
    totalAmount: taxable + taxAmount,
  };
}

/** "11%" or "12.5%". */
export function formatTaxRate(basisPoints: number): string {
  return `${(basisPoints / 100).toString()}%`;
}

/** "Beirut: $3.00, free over $100.00". */
export function describeZone(zone: ShippingZoneView): string {
  const money = (amount: number) => formatMoney(amount, zone.currency);
  const price = zone.rateAmount === 0 ? "free delivery" : money(zone.rateAmount);
  const free =
    zone.freeOverAmount !== null && zone.rateAmount > 0
      ? `, free over ${money(zone.freeOverAmount)}`
      : "";
  return `${zone.name}: ${price}${free}`;
}

/**
 * A fingerprint of the prices a shopper is shown. Checkout sends it back;
 * if staff changed an area's price or the tax in between, the order is not
 * placed and the shopper sees the new prices first.
 */
export function pricingVersion(zones: readonly ShippingZoneView[], tax: TaxSettings): string {
  const data = JSON.stringify({
    zones: zones.map((zone) => [
      zone.id,
      zone.name,
      zone.countries,
      zone.rateAmount,
      zone.freeOverAmount,
      zone.currency,
    ]),
    tax: [tax.rateBasisPoints, tax.included, tax.label],
  });
  return createHash("sha256").update(data).digest("hex").slice(0, 32);
}

// --- Reading -------------------------------------------------------------------

async function taxSettingsIn(tx: AppTransaction): Promise<TaxSettings> {
  const row = await tx.checkoutSettings.findFirst({
    select: { taxRateBasisPoints: true, taxIncluded: true, taxLabel: true },
  });
  return row
    ? { rateBasisPoints: row.taxRateBasisPoints, included: row.taxIncluded, label: row.taxLabel }
    : NO_TAX;
}

const activeZonesIn = (tx: AppTransaction) =>
  tx.shippingZone.findMany({
    where: { isActive: true },
    select: ZONE_SELECT,
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });

export interface CheckoutOptions {
  zones: ShippingZoneView[];
  tax: TaxSettings;
  version: string;
}

/** What checkout offers: the store's active delivery areas and its tax. Public information. */
export async function getCheckoutOptions(db: TenantDb): Promise<CheckoutOptions> {
  return db.run(async (tx) => {
    const [zones, tax] = await Promise.all([activeZonesIn(tx), taxSettingsIn(tx)]);
    return { zones, tax, version: pricingVersion(zones, tax) };
  });
}

export interface DeliveryQuote extends OrderPricing {
  zoneName: string | null;
  tax: TaxSettings;
}

/**
 * Prices an order inside the caller's transaction, from the database only.
 * Throws a ShippingError the shopper can act on when the chosen area is
 * missing, switched off, in another currency or does not cover the country.
 */
export async function quoteDeliveryIn(
  tx: AppTransaction,
  input: {
    zoneId: unknown;
    country: string;
    subtotalAmount: number;
    currency: string;
    /** From checkoutOptions().version; omitted means "do not check". */
    expectedVersion?: unknown;
  },
): Promise<DeliveryQuote> {
  const [zones, tax] = await Promise.all([activeZonesIn(tx), taxSettingsIn(tx)]);
  if (input.expectedVersion !== undefined && input.expectedVersion !== pricingVersion(zones, tax)) {
    throw new ShippingError(
      "invalid",
      "Delivery prices or tax have just changed. Please check the new total before placing your order.",
    );
  }
  if (zones.length === 0) {
    return { ...priceOrder(input.subtotalAmount, null, tax), zoneName: null, tax };
  }
  const zone = zones.find((candidate) => candidate.id === input.zoneId);
  if (!zone) {
    throw new ShippingError("invalid", "Choose a delivery area.", "shippingZoneId");
  }
  if (!zone.countries.includes(input.country)) {
    const others = zones.filter((candidate) => candidate.countries.includes(input.country));
    throw new ShippingError(
      "invalid",
      others.length > 0
        ? `${zone.name} is not in ${countryName(input.country)}. Choose the delivery area for your address.`
        : `Sorry, we do not deliver to ${countryName(input.country)} yet.`,
      others.length > 0 ? "shippingZoneId" : "country",
    );
  }
  if (zone.currency !== input.currency) {
    throw new ShippingError(
      "invalid",
      "Delivery to this area is priced in another currency. Please contact the store.",
      "shippingZoneId",
    );
  }
  return { ...priceOrder(input.subtotalAmount, zone, tax), zoneName: zone.name, tax };
}

// --- Staff: delivery areas -------------------------------------------------------

export interface ZoneInput {
  name: unknown;
  countries: unknown;
  rate: unknown;
  freeOver?: unknown;
  isActive?: unknown;
  position?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** "LB" or "lb, sy" -> ["LB", "SY"]. */
export function parseCountries(value: unknown): string[] {
  const codes = text(value)
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (codes.length === 0) {
    throw new ShippingError("invalid", "Enter at least one country code, such as LB.", "countries");
  }
  const known = new Set(codes.filter((code) => isCountryCode(code)));
  const unknown = codes.find((code) => !known.has(code));
  if (unknown !== undefined) {
    throw new ShippingError(
      "invalid",
      `"${unknown.slice(0, 10)}" is not a country code. Use two letters, such as LB for Lebanon.`,
      "countries",
    );
  }
  return [...new Set(codes)];
}

function cleanZone(input: ZoneInput, currency: string) {
  const name = text(input.name).replace(/\s+/g, " ");
  if (!name) throw new ShippingError("invalid", "Enter a name for the delivery area.", "name");
  if (name.length > 100) {
    throw new ShippingError("invalid", "Shorten the name (100 characters at most).", "name");
  }
  const rateAmount = parseMoney(text(input.rate), currency);
  if (rateAmount === null) {
    throw new ShippingError(
      "invalid",
      "Enter the delivery price, such as 3.00 (0 for free).",
      "rate",
    );
  }
  const freeText = text(input.freeOver);
  const freeOverAmount = freeText === "" ? null : parseMoney(freeText, currency);
  if (freeText !== "" && freeOverAmount === null) {
    throw new ShippingError(
      "invalid",
      "Enter the amount above which delivery is free, such as 100.00, or leave it empty.",
      "freeOver",
    );
  }
  const positionText = text(input.position);
  const position = positionText === "" ? 0 : Number(positionText);
  if (!Number.isInteger(position) || position < 0 || position > 999) {
    throw new ShippingError(
      "invalid",
      "Enter the order as a whole number from 0 to 999.",
      "position",
    );
  }
  return {
    name,
    countries: parseCountries(input.countries),
    rateAmount,
    freeOverAmount,
    isActive:
      input.isActive === undefined ? true : input.isActive === true || input.isActive === "on",
    position,
  };
}

async function storeCurrencyIn(tx: AppTransaction): Promise<string> {
  const store = await tx.store.findFirst({
    select: { defaultCurrency: true },
    orderBy: { createdAt: "asc" },
  });
  return store?.defaultCurrency ?? "USD";
}

const duplicateName = () =>
  new ShippingError("invalid", "Another delivery area already has this name.", "name");

/** The store's delivery areas, switched off ones included. */
export async function listShippingZones(
  db: TenantDb,
  context: RequestContext,
): Promise<{ zones: ShippingZoneView[]; currency: string }> {
  assertPermission(context, "settings.write");
  return db.run(async (tx) => ({
    zones: await tx.shippingZone.findMany({
      select: ZONE_SELECT,
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
    currency: await storeCurrencyIn(tx),
  }));
}

export async function createShippingZone(
  db: TenantDb,
  context: RequestContext,
  input: ZoneInput,
): Promise<{ id: string }> {
  assertPermission(context, "settings.write");
  try {
    return await db.run(async (tx) => {
      const currency = await storeCurrencyIn(tx);
      const data = cleanZone(input, currency);
      if ((await tx.shippingZone.count()) >= MAX_ZONES) {
        throw new ShippingError("invalid", `A store can have up to ${MAX_ZONES} delivery areas.`);
      }
      const created = await tx.shippingZone.create({
        data: { ...data, currency, tenantId: db.tenantId },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "settings.shipping_zone_created",
        {
          type: "shipping_zone",
          id: created.id,
        },
        undefined,
        { name: data.name, rateAmount: data.rateAmount },
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

export async function updateShippingZone(
  db: TenantDb,
  context: RequestContext,
  zoneId: string,
  input: ZoneInput,
): Promise<void> {
  assertPermission(context, "settings.write");
  if (typeof zoneId !== "string" || !UUID.test(zoneId)) throw new NotFoundError("shipping zone");
  try {
    await db.run(async (tx) => {
      const before = await tx.shippingZone.findUnique({
        where: { id: zoneId },
        select: ZONE_SELECT,
      });
      if (!before) throw new NotFoundError("shipping zone");
      // Amounts are in the currency the area was created with.
      const data = cleanZone(input, before.currency);
      await tx.shippingZone.update({ where: { id: zoneId }, data });
      await audit(
        tx,
        context,
        "settings.shipping_zone_updated",
        { type: "shipping_zone", id: zoneId },
        {
          name: before.name,
          countries: before.countries,
          rateAmount: before.rateAmount,
          freeOverAmount: before.freeOverAmount,
          isActive: before.isActive,
        },
        {
          name: data.name,
          countries: data.countries,
          rateAmount: data.rateAmount,
          freeOverAmount: data.freeOverAmount,
          isActive: data.isActive,
        },
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

/** Orders keep their own copy of the area's name and fee, so deleting is safe. */
export async function deleteShippingZone(
  db: TenantDb,
  context: RequestContext,
  zoneId: string,
): Promise<void> {
  assertPermission(context, "settings.write");
  if (typeof zoneId !== "string" || !UUID.test(zoneId)) throw new NotFoundError("shipping zone");
  await db.run(async (tx) => {
    const before = await tx.shippingZone.findUnique({
      where: { id: zoneId },
      select: { name: true },
    });
    if (!before) throw new NotFoundError("shipping zone");
    await tx.shippingZone.delete({ where: { id: zoneId } });
    await audit(
      tx,
      context,
      "settings.shipping_zone_deleted",
      { type: "shipping_zone", id: zoneId },
      {
        name: before.name,
      },
    );
  });
}

/** For an edit form: the amounts as typed. */
export function zoneFormValues(zone: ShippingZoneView) {
  return {
    rate: moneyToInput(zone.rateAmount, zone.currency),
    freeOver: zone.freeOverAmount === null ? "" : moneyToInput(zone.freeOverAmount, zone.currency),
    countries: zone.countries.join(", "),
  };
}

// --- Staff: tax ----------------------------------------------------------------

export async function getTaxSettings(db: TenantDb, context: RequestContext): Promise<TaxSettings> {
  assertPermission(context, "settings.write");
  return db.run(taxSettingsIn);
}

/** "11", "11.5" or "0" (percent) -> basis points. */
export function parseTaxRate(value: unknown): number {
  const raw = text(value).replace(/%$/, "").trim();
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(raw);
  const basisPoints = match
    ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
    : NaN;
  if (!Number.isInteger(basisPoints) || basisPoints > MAX_TAX_RATE_BASIS_POINTS) {
    throw new ShippingError(
      "invalid",
      "Enter the tax rate as a percentage from 0 to 50, such as 11 (0 for no tax).",
      "rate",
    );
  }
  return basisPoints;
}

export async function saveTaxSettings(
  db: TenantDb,
  context: RequestContext,
  input: { rate: unknown; included: unknown; label: unknown },
): Promise<void> {
  assertPermission(context, "settings.write");
  const rateBasisPoints = parseTaxRate(input.rate);
  const label = text(input.label).replace(/\s+/g, " ") || "VAT";
  if (label.length > 30) {
    throw new ShippingError("invalid", "Shorten the tax name (30 characters at most).", "label");
  }
  const included = input.included === true || input.included === "true";
  await db.run(async (tx) => {
    const before = await taxSettingsIn(tx);
    const data = { taxRateBasisPoints: rateBasisPoints, taxIncluded: included, taxLabel: label };
    await tx.checkoutSettings.upsert({
      where: { tenantId: db.tenantId },
      create: { tenantId: db.tenantId, ...data },
      update: data,
    });
    await audit(
      tx,
      context,
      "settings.tax_updated",
      { type: "checkout_settings", id: db.tenantId },
      { ...before },
      { rateBasisPoints, included, label },
    );
  });
}
