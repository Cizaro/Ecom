import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { isUniqueViolation } from "../catalog/errors";
import { formatMoney, moneyToInput, parseMoney } from "../catalog/money";
import { addDays, isCalendarDate, safeTimeZone, zonedDayStart } from "../platform/time";
import type { PricingDiscount } from "../shipping/shipping";

// Discount codes. Rules this file keeps:
//
// - Staff with promotions.write make codes: percent off, a fixed amount off,
//   or free delivery, with an optional minimum, dates and limits.
// - A code is checked on the server whenever it is used: at checkout to show
//   the new total, and again, with the code locked, when the order is
//   placed, so two shoppers can never both take a code's last use.
// - Uses are counted from orders: a cancelled order gives its use back.
// - A code belongs to one store; another store's code is simply unknown.
// - Nothing here creates urgency: there are no countdowns, and an end date is
//   shown only as a plain date to staff.

export const DISCOUNT_KINDS = ["percent", "fixed", "free_delivery"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export class DiscountError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "DiscountError";
  }
}

export interface DiscountCodeView {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  currency: string;
  minSubtotal: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  isActive: boolean;
  /** Orders that used it and were not cancelled. */
  used: number;
}

const SELECT = {
  id: true,
  code: true,
  kind: true,
  value: true,
  currency: true,
  minSubtotal: true,
  startsAt: true,
  endsAt: true,
  usageLimit: true,
  perCustomerLimit: true,
  isActive: true,
} as const;

/** What a shopper typed, as stored: upper case, no spaces. */
export function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase().slice(0, 60) : "";
}

/** "10% off", "$5.00 off", "Free delivery". */
export function describeDiscount(code: Pick<DiscountCodeView, "kind" | "value" | "currency">) {
  if (code.kind === "percent") return `${code.value}% off`;
  if (code.kind === "fixed") return `${formatMoney(code.value, code.currency)} off`;
  return "Free delivery";
}

async function usesIn(tx: AppTransaction, codeId: string, email?: string): Promise<number> {
  return tx.discountRedemption.count({
    where: { codeId, ...(email ? { email } : {}), order: { status: { not: "cancelled" } } },
  });
}

export interface AppliedDiscount extends PricingDiscount {
  codeId: string;
  code: string;
}

/**
 * Checks a code for an order with these items, inside the caller's
 * transaction. With `lock`, the code stays locked until the transaction ends
 * (placing an order). Throws a DiscountError the shopper can act on.
 */
export async function resolveDiscountIn(
  tx: AppTransaction,
  input: {
    code: unknown;
    subtotalAmount: number;
    currency: string;
    /** The order's email, for the per-customer limit (checked when placing). */
    email?: string;
    lock?: boolean;
    now?: Date;
  },
): Promise<AppliedDiscount> {
  const code = normalizeCode(input.code);
  const unknown = () => new DiscountError("That discount code is not valid.", "discountCode");
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw unknown();
  const found = await tx.discountCode.findFirst({ where: { code }, select: SELECT });
  if (!found) throw unknown();
  if (input.lock) {
    await tx.$queryRaw`SELECT id FROM discount_codes WHERE id = ${found.id}::uuid FOR UPDATE`;
  }
  const now = input.now ?? new Date();
  if (!found.isActive || (found.startsAt && found.startsAt > now)) throw unknown();
  if (found.endsAt && found.endsAt <= now) {
    throw new DiscountError("That discount code has ended.", "discountCode");
  }
  if (found.currency !== input.currency) throw unknown();
  if (found.minSubtotal !== null && input.subtotalAmount < found.minSubtotal) {
    throw new DiscountError(
      `This code needs items worth at least ${formatMoney(found.minSubtotal, found.currency)}.`,
      "discountCode",
    );
  }
  if (found.usageLimit !== null && (await usesIn(tx, found.id)) >= found.usageLimit) {
    throw new DiscountError("That discount code has been used up.", "discountCode");
  }
  if (
    input.email &&
    found.perCustomerLimit !== null &&
    (await usesIn(tx, found.id, input.email)) >= found.perCustomerLimit
  ) {
    throw new DiscountError(
      "You have already used this discount code as many times as it allows.",
      "discountCode",
    );
  }
  return {
    codeId: found.id,
    code: found.code,
    kind: found.kind as DiscountKind,
    value: found.value,
  };
}

/** For checkout: checks a code against the cart total without holding anything. */
export async function checkDiscountCode(
  db: TenantDb,
  input: { code: unknown; subtotalAmount: number; currency: string },
): Promise<AppliedDiscount> {
  return db.run((tx) => resolveDiscountIn(tx, input));
}

// --- Staff ---------------------------------------------------------------------

export interface DiscountInput {
  code: unknown;
  kind: unknown;
  /** Percent ("10") or amount ("5.00"); ignored for free delivery. */
  value?: unknown;
  minSubtotal?: unknown;
  /** YYYY-MM-DD, the store's day; empty for none. */
  startsOn?: unknown;
  endsOn?: unknown;
  usageLimit?: unknown;
  perCustomerLimit?: unknown;
  isActive?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function optionalWhole(value: unknown, field: string, label: string, max: number): number | null {
  const raw = text(value);
  if (raw === "") return null;
  if (!/^\d{1,7}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    throw new DiscountError(
      `Enter ${label} as a whole number from 1 to ${max}, or leave it empty.`,
      field,
    );
  }
  return Number(raw);
}

async function storeSettingsIn(tx: AppTransaction) {
  const store = await tx.store.findFirst({
    select: { defaultCurrency: true, timezone: true },
    orderBy: { createdAt: "asc" },
  });
  return { currency: store?.defaultCurrency ?? "USD", timeZone: safeTimeZone(store?.timezone) };
}

function cleanDiscount(input: DiscountInput, currency: string, timeZone: string) {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw new DiscountError(
      "Use 3 to 40 letters, digits, - or _ for the code, such as SUMMER10.",
      "code",
    );
  }
  const kind = DISCOUNT_KINDS.find((value) => value === input.kind);
  if (!kind) throw new DiscountError("Choose what the code gives.", "kind");
  let value = 0;
  if (kind === "percent") {
    const raw = text(input.value).replace(/%$/, "");
    value = /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
    if (!(value >= 1 && value <= 100)) {
      throw new DiscountError("Enter the percentage off as a whole number from 1 to 100.", "value");
    }
  } else if (kind === "fixed") {
    const amount = parseMoney(text(input.value), currency);
    if (amount === null || amount < 1) {
      throw new DiscountError("Enter the amount off, such as 5.00.", "value");
    }
    value = amount;
  }
  const minText = text(input.minSubtotal);
  const minSubtotal = minText === "" ? null : parseMoney(minText, currency);
  if (minText !== "" && minSubtotal === null) {
    throw new DiscountError(
      "Enter the minimum order, such as 50.00, or leave it empty.",
      "minSubtotal",
    );
  }
  const day = (value: unknown, field: string) => {
    const raw = text(value);
    if (raw === "") return null;
    if (!isCalendarDate(raw)) throw new DiscountError("Enter the date as YYYY-MM-DD.", field);
    return raw;
  };
  const startsOn = day(input.startsOn, "startsOn");
  const endsOn = day(input.endsOn, "endsOn");
  // A code runs from the start of its first day to the end of its last day, store time.
  const startsAt = startsOn ? zonedDayStart(startsOn, timeZone) : null;
  const endsAt = endsOn ? zonedDayStart(addDays(endsOn, 1), timeZone) : null;
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new DiscountError("The last day must be on or after the first day.", "endsOn");
  }
  return {
    code,
    kind,
    value,
    minSubtotal,
    startsAt,
    endsAt,
    usageLimit: optionalWhole(input.usageLimit, "usageLimit", "the number of uses", 1_000_000),
    perCustomerLimit: optionalWhole(
      input.perCustomerLimit,
      "perCustomerLimit",
      "the uses per customer",
      1000,
    ),
    isActive:
      input.isActive === undefined ? true : input.isActive === true || input.isActive === "on",
  };
}

export async function listDiscountCodes(
  db: TenantDb,
  context: RequestContext,
): Promise<{ codes: DiscountCodeView[]; currency: string; timeZone: string }> {
  assertPermission(context, "promotions.write");
  return db.run(async (tx) => {
    const settings = await storeSettingsIn(tx);
    const rows = await tx.discountCode.findMany({ select: SELECT, orderBy: { createdAt: "desc" } });
    const codes: DiscountCodeView[] = [];
    for (const row of rows) {
      codes.push({ ...row, kind: row.kind as DiscountKind, used: await usesIn(tx, row.id) });
    }
    return { codes, ...settings };
  });
}

const duplicate = () => new DiscountError("Another discount code already uses this code.", "code");

export async function createDiscountCode(
  db: TenantDb,
  context: RequestContext,
  input: DiscountInput,
): Promise<{ id: string }> {
  assertPermission(context, "promotions.write");
  try {
    return await db.run(async (tx) => {
      const { currency, timeZone } = await storeSettingsIn(tx);
      const data = cleanDiscount(input, currency, timeZone);
      const created = await tx.discountCode.create({
        data: { ...data, currency, tenantId: db.tenantId },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "promotions.code_created",
        { type: "discount_code", id: created.id },
        undefined,
        { code: data.code, kind: data.kind, value: data.value },
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate();
    throw error;
  }
}

export async function updateDiscountCode(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: DiscountInput,
): Promise<void> {
  assertPermission(context, "promotions.write");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("discount code");
  try {
    await db.run(async (tx) => {
      const before = await tx.discountCode.findUnique({ where: { id }, select: SELECT });
      if (!before) throw new NotFoundError("discount code");
      const { timeZone } = await storeSettingsIn(tx);
      const data = cleanDiscount(input, before.currency, timeZone);
      await tx.discountCode.update({ where: { id }, data });
      await audit(
        tx,
        context,
        "promotions.code_updated",
        { type: "discount_code", id },
        { code: before.code, kind: before.kind, value: before.value, isActive: before.isActive },
        { code: data.code, kind: data.kind, value: data.value, isActive: data.isActive },
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate();
    throw error;
  }
}

/** Deletes a code no order has used; a used code can be switched off instead. */
export async function deleteDiscountCode(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<void> {
  assertPermission(context, "promotions.write");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("discount code");
  await db.run(async (tx) => {
    const found = await tx.discountCode.findUnique({ where: { id }, select: { code: true } });
    if (!found) throw new NotFoundError("discount code");
    if ((await tx.discountRedemption.count({ where: { codeId: id } })) > 0) {
      throw new DiscountError("Orders have used this code, so it is kept. Switch it off instead.");
    }
    await tx.discountCode.delete({ where: { id } });
    await audit(
      tx,
      context,
      "promotions.code_deleted",
      { type: "discount_code", id },
      {
        code: found.code,
      },
    );
  });
}

/** For an edit form: the values as typed, dates in the store's days. */
export function discountFormValues(code: DiscountCodeView, timeZone: string) {
  const day = (date: Date | null, endExclusive = false) => {
    if (!date) return "";
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(endExclusive ? new Date(date.getTime() - 1) : date);
    return local;
  };
  return {
    value:
      code.kind === "percent"
        ? String(code.value)
        : code.kind === "fixed"
          ? moneyToInput(code.value, code.currency)
          : "",
    minSubtotal: code.minSubtotal === null ? "" : moneyToInput(code.minSubtotal, code.currency),
    startsOn: day(code.startsAt),
    endsOn: day(code.endsAt, true),
    usageLimit: code.usageLimit === null ? "" : String(code.usageLimit),
    perCustomerLimit: code.perCustomerLimit === null ? "" : String(code.perCustomerLimit),
  };
}
