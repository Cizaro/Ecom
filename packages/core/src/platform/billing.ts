import { getAdminPrisma } from "@ecom/db";
import { isCurrencyCode, parseMoney } from "../catalog/money";
import { recordAudit } from "./audit";
import { PlatformError } from "./shops";

// Plans and payments (decision D122). The platform owner sets the plans and
// their prices; a shop pays by hand (Whish, OMT, bank transfer, cash) and the
// platform owner records it, which moves the shop's "paid until" date. A card
// or online gateway can later create and settle the same invoices. Nothing
// here suspends a shop on its own: the panel lists who needs attention and
// the platform owner decides. Platform-level, so the admin connection.

export const BILLING_METHODS = ["whish", "omt", "bank", "cash", "other"] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];
export const BILLING_METHOD_LABELS: Record<BillingMethod, string> = {
  whish: "Whish",
  omt: "OMT",
  bank: "Bank transfer",
  cash: "Cash",
  other: "Other",
};

/** Days a shop has to pay a new invoice. */
export const INVOICE_DUE_DAYS = 7;
/** Days before a trial ends or a paid period runs out when the shop is warned. */
export const WARN_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  priceAmount: number;
  currency: string;
  productLimit: number | null;
  staffLimit: number | null;
  aiMonthlyBudgetAmount: number | null;
  isPublic: boolean;
  sortOrder: number;
}

const PLAN_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  priceAmount: true,
  currency: true,
  productLimit: true,
  staffLimit: true,
  aiMonthlyBudgetAmount: true,
  isPublic: true,
  sortOrder: true,
} as const;

export async function listPlans(
  adminUrl: string,
  options: { publicOnly?: boolean } = {},
): Promise<Plan[]> {
  return getAdminPrisma(adminUrl).platformPlan.findMany({
    where: options.publicOnly ? { isPublic: true } : {},
    orderBy: [{ sortOrder: "asc" }, { priceAmount: "asc" }],
    select: PLAN_SELECT,
  });
}

export interface PlanInput {
  id?: unknown;
  key: unknown;
  name: unknown;
  description?: unknown;
  price: unknown;
  currency?: unknown;
  productLimit?: unknown;
  staffLimit?: unknown;
  aiBudget?: unknown;
  isPublic?: unknown;
  sortOrder?: unknown;
}

/** A whole number from a form field; null when empty (no limit). */
function limit(value: unknown, field: string, min: number): number | null {
  const raw = text(value);
  if (!raw) return null;
  if (!/^\d{1,7}$/.test(raw) || Number(raw) < min) {
    throw new PlatformError(`Enter a whole number of at least ${min}, or leave it empty.`, field);
  }
  return Number(raw);
}

/** Creates a plan, or changes one (by id). Prices are what the platform owner types. */
export async function savePlan(
  adminUrl: string,
  actor: { userId: string | null; ip?: string | null },
  input: PlanInput,
): Promise<Plan> {
  const id = text(input.id);
  if (id && !UUID.test(id)) throw new PlatformError("Plan not found.");
  const key = text(input.key).toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(key) || key === "trial") {
    throw new PlatformError(
      'Use lower-case letters, digits and underscores for the key, e.g. starter (not "trial").',
      "key",
    );
  }
  const name = text(input.name);
  if (!name || name.length > 60) throw new PlatformError("Give the plan a name.", "name");
  const description = text(input.description).slice(0, 500);
  const currency = (text(input.currency) || "USD").toUpperCase();
  if (!isCurrencyCode(currency)) throw new PlatformError("Choose a currency.", "currency");
  const priceAmount = parseMoney(text(input.price), currency);
  if (priceAmount === null) throw new PlatformError("Enter the monthly price, e.g. 25.", "price");
  const aiRaw = text(input.aiBudget);
  const aiMonthlyBudgetAmount = aiRaw ? parseMoney(aiRaw, "USD") : null;
  if (aiRaw && aiMonthlyBudgetAmount === null) {
    throw new PlatformError(
      "Enter the monthly AI amount in dollars, or leave it empty.",
      "aiBudget",
    );
  }
  const data = {
    key,
    name,
    description,
    priceAmount,
    currency,
    productLimit: limit(input.productLimit, "productLimit", 0),
    staffLimit: limit(input.staffLimit, "staffLimit", 1),
    aiMonthlyBudgetAmount,
    isPublic: input.isPublic === true || input.isPublic === "on",
    sortOrder: limit(input.sortOrder, "sortOrder", 0) ?? 0,
  };
  const db = getAdminPrisma(adminUrl);
  const clash = await db.platformPlan.findUnique({ where: { key }, select: { id: true } });
  if (clash && clash.id !== id) throw new PlatformError("Another plan has that key.", "key");
  return db.$transaction(async (tx) => {
    let plan: Plan;
    if (id) {
      const before = await tx.platformPlan.findUnique({ where: { id }, select: { key: true } });
      if (!before) throw new PlatformError("Plan not found.");
      plan = await tx.platformPlan.update({ where: { id }, data, select: PLAN_SELECT });
      // Shops on the plan keep it under its new key.
      if (before.key !== key) {
        await tx.tenant.updateMany({ where: { plan: before.key }, data: { plan: key } });
      }
    } else {
      plan = await tx.platformPlan.create({ data, select: PLAN_SELECT });
    }
    await recordAudit(tx, {
      tenantId: null,
      actorType: actor.userId ? "platform_admin" : "system",
      actorUserId: actor.userId,
      action: id ? "platform.plan_updated" : "platform.plan_created",
      entityType: "platform_plan",
      entityId: plan.id,
      after: { key, name, priceAmount, currency },
      ip: actor.ip ?? null,
    });
    return plan;
  });
}

export async function getPaymentInstructions(adminUrl: string): Promise<string> {
  const row = await getAdminPrisma(adminUrl).platformSetting.findUnique({
    where: { id: 1 },
    select: { paymentInstructions: true },
  });
  return row?.paymentInstructions ?? "";
}

export async function savePaymentInstructions(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  value: unknown,
): Promise<void> {
  const paymentInstructions = text(value);
  if (paymentInstructions.length > 2000) {
    throw new PlatformError("Keep the instructions under 2000 characters.", "paymentInstructions");
  }
  const db = getAdminPrisma(adminUrl);
  await db.$transaction(async (tx) => {
    await tx.platformSetting.upsert({
      where: { id: 1 },
      create: { id: 1, paymentInstructions },
      update: { paymentInstructions },
    });
    await recordAudit(tx, {
      tenantId: null,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: "platform.payment_instructions_updated",
      entityType: "platform_setting",
      entityId: "1",
      ip: actor.ip ?? null,
    });
  });
}

/** Puts a shop on a plan. The plan's AI amount becomes the shop's monthly AI budget. */
export async function setShopPlan(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  tenantId: string,
  planKey: unknown,
): Promise<void> {
  if (!UUID.test(tenantId)) throw new PlatformError("Shop not found.");
  const key = text(planKey);
  const db = getAdminPrisma(adminUrl);
  const plan = await db.platformPlan.findUnique({ where: { key }, select: PLAN_SELECT });
  if (!plan) throw new PlatformError("Choose a plan.", "plan");
  await db.$transaction(async (tx) => {
    const before = await tx.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
    if (!before) throw new PlatformError("Shop not found.");
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        plan: plan.key,
        ...(plan.aiMonthlyBudgetAmount !== null
          ? { aiMonthlyBudgetAmount: plan.aiMonthlyBudgetAmount, aiBudgetCurrency: "USD" }
          : {}),
      },
    });
    await recordAudit(tx, {
      tenantId,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: "platform.plan_changed",
      entityType: "tenant",
      entityId: tenantId,
      before: { plan: before.plan },
      after: { plan: plan.key },
      ip: actor.ip ?? null,
    });
  });
}

export interface Invoice {
  id: string;
  tenantId: string;
  number: string;
  planKey: string;
  description: string;
  amount: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  status: "open" | "paid" | "void";
  paidAt: Date | null;
  method: string | null;
  reference: string | null;
  createdAt: Date;
}

const INVOICE_SELECT = {
  id: true,
  tenantId: true,
  number: true,
  planKey: true,
  description: true,
  amount: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  dueAt: true,
  status: true,
  paidAt: true,
  method: true,
  reference: true,
  createdAt: true,
} as const;

const asInvoice = <T extends { status: string }>(row: T) =>
  ({ ...row, status: row.status as Invoice["status"] }) as T & { status: Invoice["status"] };

/** Adds calendar months, keeping the day where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

/**
 * Bills a shop for its plan for 1 to 12 months. The period starts where the
 * shop's paid time ends (or now, if that has passed or it never paid), so
 * paying early never loses days.
 */
export async function createInvoice(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  tenantId: string,
  input: { months: unknown; planKey?: unknown },
  now = new Date(),
): Promise<Invoice> {
  if (!UUID.test(tenantId)) throw new PlatformError("Shop not found.");
  const months = Number(text(input.months) || input.months);
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    throw new PlatformError("Bill for 1 to 12 months.", "months");
  }
  const db = getAdminPrisma(adminUrl);
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, plan: true, paidUntil: true },
  });
  if (!tenant) throw new PlatformError("Shop not found.");
  const key = text(input.planKey) || (tenant.plan && tenant.plan !== "trial" ? tenant.plan : "");
  const plan = key
    ? await db.platformPlan.findUnique({ where: { key }, select: PLAN_SELECT })
    : null;
  if (!plan) throw new PlatformError("Put the shop on a plan first, or choose one.", "planKey");

  const periodStart = tenant.paidUntil && tenant.paidUntil > now ? tenant.paidUntil : now;
  const periodEnd = addMonths(periodStart, months);
  const amount = plan.priceAmount * months;
  const year = now.getUTCFullYear();
  return db.$transaction(async (tx) => {
    const count = await tx.platformInvoice.count({
      where: { number: { startsWith: `INV-${year}-` } },
    });
    const invoice = await tx.platformInvoice.create({
      data: {
        tenantId,
        number: `INV-${year}-${String(count + 1).padStart(4, "0")}`,
        planKey: plan.key,
        description: `${plan.name} plan, ${months} ${months === 1 ? "month" : "months"}`,
        amount,
        currency: plan.currency,
        periodStart,
        periodEnd,
        dueAt: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY),
        createdByUserId: actor.userId,
      },
      select: INVOICE_SELECT,
    });
    await recordAudit(tx, {
      tenantId,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: "platform.invoice_created",
      entityType: "platform_invoice",
      entityId: invoice.id,
      after: { number: invoice.number, amount, currency: plan.currency, months },
      ip: actor.ip ?? null,
    });
    return asInvoice(invoice);
  });
}

/**
 * Records that a shop paid an invoice: the shop is paid up to the end of the
 * invoice's period, and a shop still on its trial moves to the invoice's plan.
 */
export async function markInvoicePaid(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  invoiceId: string,
  input: { method: unknown; reference?: unknown },
  now = new Date(),
): Promise<void> {
  if (!UUID.test(invoiceId)) throw new PlatformError("Invoice not found.");
  const method = BILLING_METHODS.find((m) => m === text(input.method));
  if (!method) throw new PlatformError("Choose how it was paid.", "method");
  const reference = text(input.reference).slice(0, 200) || null;
  const db = getAdminPrisma(adminUrl);
  await db.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({
      where: { id: invoiceId },
      select: { tenantId: true, status: true, periodEnd: true, planKey: true, number: true },
    });
    if (!invoice) throw new PlatformError("Invoice not found.");
    if (invoice.status !== "open") throw new PlatformError("Only an open invoice can be paid.");
    await tx.platformInvoice.update({
      where: { id: invoiceId },
      data: { status: "paid", paidAt: now, method, reference },
    });
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: invoice.tenantId },
      select: { paidUntil: true, plan: true },
    });
    const paidUntil =
      tenant.paidUntil && tenant.paidUntil > invoice.periodEnd
        ? tenant.paidUntil
        : invoice.periodEnd;
    await tx.tenant.update({
      where: { id: invoice.tenantId },
      data: {
        paidUntil,
        ...(tenant.plan === "trial" || tenant.plan === null ? { plan: invoice.planKey } : {}),
      },
    });
    await recordAudit(tx, {
      tenantId: invoice.tenantId,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: "platform.invoice_paid",
      entityType: "platform_invoice",
      entityId: invoiceId,
      after: { number: invoice.number, method, paidUntil: paidUntil.toISOString() },
      ip: actor.ip ?? null,
    });
  });
}

/** Cancels an open invoice (a mistake, or agreed with the client). */
export async function voidInvoice(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  invoiceId: string,
): Promise<void> {
  if (!UUID.test(invoiceId)) throw new PlatformError("Invoice not found.");
  const db = getAdminPrisma(adminUrl);
  await db.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({
      where: { id: invoiceId },
      select: { tenantId: true, status: true, number: true },
    });
    if (!invoice) throw new PlatformError("Invoice not found.");
    if (invoice.status !== "open")
      throw new PlatformError("Only an open invoice can be cancelled.");
    await tx.platformInvoice.update({ where: { id: invoiceId }, data: { status: "void" } });
    await recordAudit(tx, {
      tenantId: invoice.tenantId,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: "platform.invoice_voided",
      entityType: "platform_invoice",
      entityId: invoiceId,
      after: { number: invoice.number },
      ip: actor.ip ?? null,
    });
  });
}

export async function listInvoices(
  adminUrl: string,
  filter: { tenantId?: string; status?: string } = {},
): Promise<(Invoice & { shopName: string })[]> {
  if (filter.tenantId && !UUID.test(filter.tenantId)) return [];
  const status = (["open", "paid", "void"] as const).find((s) => s === filter.status);
  const rows = await getAdminPrisma(adminUrl).platformInvoice.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { ...INVOICE_SELECT, tenant: { select: { name: true } } },
  });
  return rows.map(({ tenant, ...row }) => ({ ...asInvoice(row), shopName: tenant.name }));
}

export type BillingState =
  "trial" | "trial_ending" | "trial_ended" | "paid" | "renewal_due" | "overdue" | "managed";

/**
 * Where a shop stands. "managed": set up by the platform owner with no
 * payment recorded yet (billed outside the platform, or not yet).
 */
export function billingState(
  shop: { plan: string | null; trialEndsAt: Date | null; paidUntil: Date | null },
  now = new Date(),
): BillingState {
  if (shop.paidUntil) {
    if (shop.paidUntil <= now) return "overdue";
    return shop.paidUntil.getTime() - now.getTime() <= WARN_DAYS * DAY ? "renewal_due" : "paid";
  }
  if (shop.plan === "trial" && shop.trialEndsAt) {
    if (shop.trialEndsAt <= now) return "trial_ended";
    return shop.trialEndsAt.getTime() - now.getTime() <= WARN_DAYS * DAY ? "trial_ending" : "trial";
  }
  return "managed";
}

export const BILLING_STATE_LABELS: Record<BillingState, string> = {
  trial: "On trial",
  trial_ending: "Trial ending soon",
  trial_ended: "Trial ended",
  paid: "Paid",
  renewal_due: "Renewal due soon",
  overdue: "Payment overdue",
  managed: "Set up by you",
};

/** Shops that need the platform owner: trials ending or ended, renewals due, overdue, unpaid invoices. */
export async function shopsNeedingAttention(
  adminUrl: string,
  now = new Date(),
): Promise<
  {
    id: string;
    name: string;
    state: BillingState;
    date: Date | null;
    openInvoices: number;
    status: string;
  }[]
> {
  const db = getAdminPrisma(adminUrl);
  const soon = new Date(now.getTime() + WARN_DAYS * DAY);
  const tenants = await db.tenant.findMany({
    where: {
      OR: [
        { plan: "trial", paidUntil: null, trialEndsAt: { lte: soon } },
        { paidUntil: { lte: soon } },
        { platformInvoices: { some: { status: "open" } } },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      plan: true,
      trialEndsAt: true,
      paidUntil: true,
      _count: { select: { platformInvoices: { where: { status: "open" } } } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    state: billingState(t, now),
    date: t.paidUntil ?? t.trialEndsAt,
    openInvoices: t._count.platformInvoices,
  }));
}

/** What a shop's own billing page shows: its plan, where it stands, its invoices, how to pay. */
export async function getShopBilling(adminUrl: string, tenantId: string, now = new Date()) {
  const db = getAdminPrisma(adminUrl);
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, trialEndsAt: true, paidUntil: true },
  });
  if (!tenant) throw new PlatformError("Shop not found.");
  const [plan, plans, invoices, paymentInstructions] = [
    tenant.plan && tenant.plan !== "trial"
      ? await db.platformPlan.findUnique({ where: { key: tenant.plan }, select: PLAN_SELECT })
      : null,
    await listPlans(adminUrl, { publicOnly: true }),
    (
      await db.platformInvoice.findMany({
        where: { tenantId, status: { not: "void" } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: INVOICE_SELECT,
      })
    ).map(asInvoice),
    await getPaymentInstructions(adminUrl),
  ];
  return {
    plan,
    onTrial: tenant.plan === "trial",
    trialEndsAt: tenant.trialEndsAt,
    paidUntil: tenant.paidUntil,
    state: billingState(tenant, now),
    plans,
    invoices,
    paymentInstructions,
  };
}

export type ShopBilling = Awaited<ReturnType<typeof getShopBilling>>;
