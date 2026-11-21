import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { parseMoney } from "../catalog/money";
import { featureProblem } from "../tenancy/plan-limits";
import { assertMarketingId, COUNTED_ORDER_STATUSES, MarketingError } from "./campaigns";

// Customer segments (Milestone 7.1, decision D107): a named group described
// by rules over the store's own orders. Counting needs marketing.write;
// seeing who is in it needs customers.read as well; exporting needs
// customers.export, and the export holds only customers who agreed to
// marketing emails (their latest choice), never anyone else.

export interface SegmentRules {
  /** At least this many orders. */
  minOrders?: number;
  /** At least this much spent, in minor units (after refunds). */
  minSpentAmount?: number;
  /** Ordered in the last N days. */
  orderedWithinDays?: number;
  /** No order for at least N days (customers who have ordered before). */
  noOrderForDays?: number;
  /** Bought at least one product from this category. */
  categoryId?: string;
}

export interface SegmentRuleInput {
  minOrders?: unknown;
  minSpent?: unknown;
  orderedWithinDays?: unknown;
  noOrderForDays?: unknown;
  categoryId?: unknown;
}

async function currencyOf(db: TenantDb) {
  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
  );
  return store?.defaultCurrency ?? "USD";
}

/** Checks a form's rules; empty fields mean "no rule". */
export async function cleanSegmentRules(
  db: TenantDb,
  input: SegmentRuleInput,
): Promise<SegmentRules> {
  const whole = (value: unknown, max: number, field: string, message: string) => {
    const textValue = typeof value === "string" ? value.trim() : "";
    if (!textValue) return undefined;
    const number = Number(textValue);
    if (!Number.isInteger(number) || number < 1 || number > max) {
      throw new MarketingError(message, field);
    }
    return number;
  };
  const rules: SegmentRules = {};
  const minOrders = whole(input.minOrders, 1000, "minOrders", "Enter a number of orders from 1.");
  if (minOrders) rules.minOrders = minOrders;
  const spent = typeof input.minSpent === "string" ? input.minSpent.trim() : "";
  if (spent) {
    const amount = parseMoney(spent, await currencyOf(db));
    if (!amount) throw new MarketingError("Enter the amount spent, like 100.", "minSpent");
    rules.minSpentAmount = amount;
  }
  const within = whole(
    input.orderedWithinDays,
    3650,
    "orderedWithinDays",
    "Enter a number of days from 1 to 3650.",
  );
  if (within) rules.orderedWithinDays = within;
  const since = whole(
    input.noOrderForDays,
    3650,
    "noOrderForDays",
    "Enter a number of days from 1 to 3650.",
  );
  if (since) rules.noOrderForDays = since;
  if (within && since && since >= within) {
    throw new MarketingError(
      "No customer can have ordered in the last days and not ordered for longer. Change one of the two.",
      "noOrderForDays",
    );
  }
  if (typeof input.categoryId === "string" && input.categoryId) {
    assertMarketingId(input.categoryId, "category");
    const category = await db.run((tx) =>
      tx.category.findUnique({ where: { id: input.categoryId as string }, select: { id: true } }),
    );
    if (!category) throw new MarketingError("That category no longer exists.", "categoryId");
    rules.categoryId = input.categoryId;
  }
  return rules;
}

/** Reads stored rules defensively (only known keys with sensible values). */
export function readSegmentRules(value: unknown): SegmentRules {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const positive = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
  const rules: SegmentRules = {};
  if (positive(raw.minOrders)) rules.minOrders = raw.minOrders as number;
  if (positive(raw.minSpentAmount)) rules.minSpentAmount = raw.minSpentAmount as number;
  if (positive(raw.orderedWithinDays)) rules.orderedWithinDays = raw.orderedWithinDays as number;
  if (positive(raw.noOrderForDays)) rules.noOrderForDays = raw.noOrderForDays as number;
  if (typeof raw.categoryId === "string") rules.categoryId = raw.categoryId;
  return rules;
}

export interface SegmentMember {
  id: string;
  name: string;
  email: string;
  orders: number;
  spentAmount: number;
  lastOrderAt: Date | null;
  marketingConsent: boolean;
}

/** Everyone the rules match, with whether each agreed to marketing emails. */
async function evaluate(
  db: TenantDb,
  rules: SegmentRules,
  now = new Date(),
): Promise<SegmentMember[]> {
  return db.run(async (tx) => {
    const orderWhere = {
      customerId: { not: null },
      status: { in: [...COUNTED_ORDER_STATUSES] },
    };
    const stats = await tx.order.groupBy({
      by: ["customerId"],
      where: orderWhere,
      _count: { _all: true },
      _sum: { totalAmount: true, refundedAmount: true },
      _max: { placedAt: true },
    });
    let category: Set<string> | null = null;
    if (rules.categoryId) {
      const buyers = await tx.order.findMany({
        where: {
          ...orderWhere,
          items: { some: { variant: { product: { categoryId: rules.categoryId } } } },
        },
        select: { customerId: true },
        distinct: ["customerId"],
      });
      category = new Set(buyers.map((b) => b.customerId!));
    }
    const day = 86_400_000;
    const matched = stats.filter((s) => {
      const orders = s._count._all;
      const spent = (s._sum.totalAmount ?? 0) - (s._sum.refundedAmount ?? 0);
      const last = s._max.placedAt;
      if (rules.minOrders && orders < rules.minOrders) return false;
      if (rules.minSpentAmount && spent < rules.minSpentAmount) return false;
      if (
        rules.orderedWithinDays &&
        (!last || now.getTime() - last.getTime() > rules.orderedWithinDays * day)
      )
        return false;
      if (
        rules.noOrderForDays &&
        (!last || now.getTime() - last.getTime() < rules.noOrderForDays * day)
      )
        return false;
      if (category && !category.has(s.customerId!)) return false;
      return true;
    });
    // With no rule about orders, everyone counts, including customers who never ordered.
    const anyOrderRule =
      rules.minOrders ||
      rules.minSpentAmount ||
      rules.orderedWithinDays ||
      rules.noOrderForDays ||
      rules.categoryId;
    const byId = new Map(matched.map((s) => [s.customerId!, s]));
    const customers = await tx.customer.findMany({
      where: { status: "active", ...(anyOrderRule ? { id: { in: [...byId.keys()] } } : {}) },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
      take: 20_000,
    });
    const consents = await tx.consentRecord.findMany({
      where: {
        subjectType: "customer",
        purpose: "marketing_email",
        subjectId: { in: customers.map((c) => c.id) },
      },
      select: { subjectId: true, granted: true },
      orderBy: { recordedAt: "desc" },
    });
    const latest = new Map<string, boolean>();
    for (const consent of consents) {
      if (!latest.has(consent.subjectId)) latest.set(consent.subjectId, consent.granted);
    }
    const all = new Map(stats.map((s) => [s.customerId!, s]));
    return customers.map((c) => {
      const s = all.get(c.id);
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        orders: s?._count._all ?? 0,
        spentAmount: s ? (s._sum.totalAmount ?? 0) - (s._sum.refundedAmount ?? 0) : 0,
        lastOrderAt: s?._max.placedAt ?? null,
        marketingConsent: latest.get(c.id) === true,
      };
    });
  });
}

export interface SegmentView {
  id: string;
  name: string;
  rules: SegmentRules;
  count: number;
  withConsent: number;
  campaignCount: number;
}

async function loadSegment(db: TenantDb, id: string) {
  assertMarketingId(id, "segment");
  const row = await db.run((tx) =>
    tx.customerSegment.findUnique({
      where: { id },
      select: { id: true, name: true, rules: true, _count: { select: { campaigns: true } } },
    }),
  );
  if (!row) throw new NotFoundError("segment");
  return row;
}

const cleanName = (value: unknown) => {
  const name = (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();
  if (!name) throw new MarketingError("Give the segment a name.", "name");
  if (name.length > 80)
    throw new MarketingError("Shorten the name (80 characters at most).", "name");
  return name;
};

const duplicate = (error: unknown) =>
  error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002";

export async function saveSegment(
  db: TenantDb,
  context: RequestContext,
  id: string | null,
  input: { name: unknown } & SegmentRuleInput,
): Promise<{ id: string }> {
  assertPermission(context, "marketing.write");
  const name = cleanName(input.name);
  const rules = await cleanSegmentRules(db, input);
  try {
    return await db.run(async (tx) => {
      // New segments are part of campaigns; existing ones can still be edited.
      if (!id) {
        const notIncluded = await featureProblem(tx, "campaigns");
        if (notIncluded) throw new MarketingError(notIncluded);
      }
      if (id) {
        assertMarketingId(id, "segment");
        const updated = await tx.customerSegment.updateMany({
          where: { id },
          data: { name, rules: { ...rules } },
        });
        if (updated.count === 0) throw new NotFoundError("segment");
        await audit(tx, context, "marketing.segment_updated", { type: "customer_segment", id });
        return { id };
      }
      const created = await tx.customerSegment.create({
        data: { tenantId: db.tenantId, name, rules: { ...rules }, createdByUserId: context.userId },
        select: { id: true },
      });
      await audit(tx, context, "marketing.segment_created", {
        type: "customer_segment",
        id: created.id,
      });
      return created;
    });
  } catch (error) {
    if (duplicate(error)) throw new MarketingError("A segment with this name exists.", "name");
    throw error;
  }
}

export async function deleteSegment(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<void> {
  assertPermission(context, "marketing.write");
  assertMarketingId(id, "segment");
  await db.run(async (tx) => {
    const deleted = await tx.customerSegment.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new NotFoundError("segment");
    await audit(tx, context, "marketing.segment_deleted", { type: "customer_segment", id });
  });
}

/** Segments with how many customers match now, and how many agreed to marketing emails. */
export async function listSegments(db: TenantDb, context: RequestContext): Promise<SegmentView[]> {
  assertPermission(context, "marketing.write");
  const rows = await db.run((tx) =>
    tx.customerSegment.findMany({
      select: { id: true, name: true, rules: true, _count: { select: { campaigns: true } } },
      orderBy: { name: "asc" },
      take: 100,
    }),
  );
  return Promise.all(
    rows.map(async (row) => {
      const rules = readSegmentRules(row.rules);
      const members = await evaluate(db, rules);
      return {
        id: row.id,
        name: row.name,
        rules,
        count: members.length,
        withConsent: members.filter((m) => m.marketingConsent).length,
        campaignCount: row._count.campaigns,
      };
    }),
  );
}

export async function getSegment(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<SegmentView> {
  assertPermission(context, "marketing.write");
  const row = await loadSegment(db, id);
  const rules = readSegmentRules(row.rules);
  const members = await evaluate(db, rules);
  return {
    id: row.id,
    name: row.name,
    rules,
    count: members.length,
    withConsent: members.filter((m) => m.marketingConsent).length,
    campaignCount: row._count.campaigns,
  };
}

/** Who is in the segment (the biggest spenders first). Needs customers.read too. */
export async function segmentMembers(
  db: TenantDb,
  context: RequestContext,
  id: string,
  limit = 50,
): Promise<SegmentMember[]> {
  assertPermission(context, "marketing.write");
  assertPermission(context, "customers.read");
  const row = await loadSegment(db, id);
  const members = await evaluate(db, readSegmentRules(row.rules));
  return members.sort((a, b) => b.spentAmount - a.spentAmount).slice(0, Math.min(limit, 200));
}

const csvCell = (value: string) => {
  // Guards spreadsheet formulas and quotes every cell.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * The segment's customers who agreed to marketing emails, as CSV (email,
 * name), for an email tool; with no segment, every customer who agreed.
 * Needs customers.export; written to the audit log.
 */
export async function exportSegmentCsv(
  db: TenantDb,
  context: RequestContext,
  id: string | null,
): Promise<{ csv: string; filename: string; count: number }> {
  assertPermission(context, "marketing.write");
  assertPermission(context, "customers.export");
  const row = id ? await loadSegment(db, id) : null;
  const members = (await evaluate(db, readSegmentRules(row?.rules ?? {}))).filter(
    (m) => m.marketingConsent,
  );
  const lines = ["email,name", ...members.map((m) => `${csvCell(m.email)},${csvCell(m.name)}`)];
  await db.run((tx) =>
    audit(
      tx,
      context,
      "marketing.segment_exported",
      { type: "customer_segment", id: row?.id ?? null },
      undefined,
      { rows: members.length },
    ),
  );
  const slug = row
    ? row.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "segment"
    : "all-who-agreed";
  return { csv: `${lines.join("\n")}\n`, filename: `segment-${slug}.csv`, count: members.length };
}
