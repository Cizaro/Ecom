import { randomBytes } from "node:crypto";
import { getAdminPrisma } from "@ecom/db";
import { hashPassword } from "../identity/password";
import { isCurrencyCode } from "../catalog/money";
import { normalizeHost } from "../tenancy/store-host";
import { safeTimeZone } from "./time";
import { recordAudit } from "./audit";

// The platform owner's panel (decision D120): every shop on the platform,
// how it is doing, creating one with its owner, suspending and resuming.
// Platform-level by nature, so it uses the admin connection and is only
// reached through requirePlatformAdmin(). It reads figures across shops and
// never changes a shop's own data (orders, products, customers); a suspended
// shop's website stops answering and its staff cannot open its admin (the
// database already refuses both), and nothing is deleted.

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export type ShopStatus = "active" | "suspended" | "closed";

/** Orders that count as sales (placed and not cancelled). */
const SOLD = ["confirmed", "paid", "fulfilled", "refunded"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export interface PlatformOverview {
  shops: { total: number; active: number; suspended: number; newThisMonth: number };
  staff: number;
  /** Across every shop, in each currency (amounts in minor units). */
  salesThisMonth: { currency: string; amount: number; orders: number }[];
  aiCostThisMonthMicros: number;
  /** Shops with the most orders in the last 30 days. */
  busiest: { id: string; name: string; orders: number }[];
  /** Newest shops. */
  newest: { id: string; name: string; slug: string; createdAt: Date; status: ShopStatus }[];
  /** Orders per day across all shops, last 14 days, oldest first. */
  ordersPerDay: { day: string; orders: number }[];
}

export async function platformOverview(
  adminUrl: string,
  now = new Date(),
): Promise<PlatformOverview> {
  const db = getAdminPrisma(adminUrl);
  const month = monthStart(now);
  const statusGroups = await db.tenant.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (status: ShopStatus) =>
    statusGroups.find((g) => g.status === status)?._count._all ?? 0;
  const newThisMonth = await db.tenant.count({ where: { createdAt: { gte: month } } });
  const staff = await db.user.count({ where: { deletedAt: null, memberships: { some: {} } } });
  const sales = await db.order.groupBy({
    by: ["currency"],
    where: { status: { in: [...SOLD] }, createdAt: { gte: month } },
    _sum: { totalAmount: true },
    _count: { _all: true },
  });
  const ai = await db.aiEvent.aggregate({
    where: { createdAt: { gte: month } },
    _sum: { costMicros: true },
  });
  const busiestRows = await db.order.groupBy({
    by: ["tenantId"],
    where: { createdAt: { gte: daysAgo(now, 30) } },
    _count: { _all: true },
    orderBy: { _count: { tenantId: "desc" } },
    take: 5,
  });
  const names = await db.tenant.findMany({
    where: { id: { in: busiestRows.map((r) => r.tenantId) } },
    select: { id: true, name: true },
  });
  const newest = await db.tenant.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, name: true, slug: true, createdAt: true, status: true },
  });
  const since = daysAgo(now, 13);
  since.setUTCHours(0, 0, 0, 0);
  const daily = await db.$queryRaw<{ day: Date; orders: bigint }[]>`
    SELECT date_trunc('day', created_at) AS day, count(*) AS orders
    FROM orders WHERE created_at >= ${since}
    GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(daily.map((r) => [r.day.toISOString().slice(0, 10), Number(r.orders)]));
  const ordersPerDay = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, orders: byDay.get(day) ?? 0 };
  });
  return {
    shops: {
      total: count("active") + count("suspended") + count("closed"),
      active: count("active"),
      suspended: count("suspended"),
      newThisMonth,
    },
    staff,
    salesThisMonth: sales
      .map((s) => ({
        currency: s.currency,
        amount: s._sum.totalAmount ?? 0,
        orders: s._count._all,
      }))
      .sort((a, b) => b.orders - a.orders),
    aiCostThisMonthMicros: ai._sum.costMicros ?? 0,
    busiest: busiestRows.map((r) => ({
      id: r.tenantId,
      name: names.find((n) => n.id === r.tenantId)?.name ?? "Shop",
      orders: r._count._all,
    })),
    newest: newest.map((t) => ({ ...t, status: t.status as ShopStatus })),
    ordersPerDay,
  };
}

export interface ShopRow {
  id: string;
  name: string;
  slug: string;
  status: ShopStatus;
  /** "trial" for a sign-up on a free trial; null when set up and billed by hand. */
  plan: string | null;
  trialEndsAt: Date | null;
  createdAt: Date;
  address: string | null;
  owner: string | null;
  products: number;
  orders30d: number;
  lastOrderAt: Date | null;
  aiCostThisMonthMicros: number;
}

export async function listShops(
  adminUrl: string,
  input: { search?: string; status?: string } = {},
  now = new Date(),
): Promise<ShopRow[]> {
  const db = getAdminPrisma(adminUrl);
  const search = (input.search ?? "").trim().slice(0, 100);
  const status = (["active", "suspended", "closed"] as const).find((s) => s === input.status);
  const tenants = await db.tenant.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { slug: { contains: search.toLowerCase() } },
              { storeDomains: { some: { hostname: { contains: search.toLowerCase() } } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      trialEndsAt: true,
      createdAt: true,
      storeDomains: { orderBy: { isPrimary: "desc" }, take: 1, select: { hostname: true } },
      memberships: {
        where: { role: { key: "store_owner" } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { user: { select: { email: true } } },
      },
    },
  });
  const ids = tenants.map((t) => t.id);
  const [products, orders, lastOrders, ai] = [
    await db.product.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: ids }, status: "active" },
      _count: { _all: true },
    }),
    await db.order.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: ids }, createdAt: { gte: daysAgo(now, 30) } },
      _count: { _all: true },
    }),
    await db.order.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: ids } },
      _max: { createdAt: true },
    }),
    await db.aiEvent.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: ids }, createdAt: { gte: monthStart(now) } },
      _sum: { costMicros: true },
    }),
  ];
  const of = <T extends { tenantId: string }>(rows: T[], id: string) =>
    rows.find((r) => r.tenantId === id);
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status as ShopStatus,
    plan: t.plan,
    trialEndsAt: t.trialEndsAt,
    createdAt: t.createdAt,
    address: t.storeDomains[0]?.hostname ?? null,
    owner: t.memberships[0]?.user.email ?? null,
    products: of(products, t.id)?._count._all ?? 0,
    orders30d: of(orders, t.id)?._count._all ?? 0,
    lastOrderAt: of(lastOrders, t.id)?._max.createdAt ?? null,
    aiCostThisMonthMicros: of(ai, t.id)?._sum.costMicros ?? 0,
  }));
}

export interface ShopDetail extends ShopRow {
  currency: string;
  timezone: string;
  addresses: { hostname: string; isPrimary: boolean }[];
  team: { email: string; name: string; role: string; twoFactor: boolean; status: string }[];
  customers: number;
  ordersTotal: number;
  sales30d: { currency: string; amount: number }[];
  instagram: string | null;
  facebookPage: string | null;
  aiAutomation: string;
  recent: { at: Date; action: string; actor: string }[];
}

export async function getShop(
  adminUrl: string,
  id: string,
  now = new Date(),
): Promise<ShopDetail | null> {
  if (!UUID.test(id)) return null;
  const db = getAdminPrisma(adminUrl);
  const tenant = await db.tenant.findUnique({ where: { id }, select: { slug: true } });
  if (!tenant) return null;
  const [row] = (await listShops(adminUrl, { search: tenant.slug }, now)).filter(
    (r) => r.id === id,
  );
  if (!row) return null;
  const store = await db.store.findFirst({
    where: { tenantId: id },
    orderBy: { createdAt: "asc" },
    select: { defaultCurrency: true, timezone: true },
  });
  const addresses = await db.storeDomain.findMany({
    where: { tenantId: id },
    orderBy: [{ isPrimary: "desc" }, { hostname: "asc" }],
    select: { hostname: true, isPrimary: true },
  });
  const members = await db.userTenantMembership.findMany({
    where: { tenantId: id },
    orderBy: { createdAt: "asc" },
    select: {
      status: true,
      role: { select: { name: true } },
      user: { select: { email: true, name: true, twoFactorEnabled: true } },
    },
  });
  const customers = await db.customer.count({ where: { tenantId: id } });
  const ordersTotal = await db.order.count({ where: { tenantId: id } });
  const sales = await db.order.groupBy({
    by: ["currency"],
    where: { tenantId: id, status: { in: [...SOLD] }, createdAt: { gte: daysAgo(now, 30) } },
    _sum: { totalAmount: true },
  });
  const social = await db.socialConnection.findFirst({
    where: { tenantId: id },
    select: { pageName: true, instagramUsername: true },
  });
  const ai = await db.aiSettings.findUnique({
    where: { tenantId: id },
    select: { automation: true },
  });
  const audit = await db.auditLog.findMany({
    where: { tenantId: id },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { createdAt: true, action: true, actorType: true },
  });
  return {
    ...row,
    currency: store?.defaultCurrency ?? "USD",
    timezone: store?.timezone ?? "UTC",
    addresses,
    team: members.map((m) => ({
      email: m.user.email,
      name: m.user.name,
      role: m.role.name,
      twoFactor: m.user.twoFactorEnabled,
      status: m.status,
    })),
    customers,
    ordersTotal,
    sales30d: sales.map((s) => ({ currency: s.currency, amount: s._sum.totalAmount ?? 0 })),
    instagram: social?.instagramUsername ?? null,
    facebookPage: social?.pageName ?? null,
    aiAutomation: ai?.automation ?? "approval",
    recent: audit.map((a) => ({ at: a.createdAt, action: a.action, actor: a.actorType })),
  };
}

export interface CreateShopInput {
  name: unknown;
  slug: unknown;
  address: unknown;
  ownerEmail: unknown;
  ownerName: unknown;
  currency?: unknown;
  timezone?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Creates a shop with its web address and its first owner. A new owner gets
 * an account without a usable password; the caller sends them the email to
 * choose one. An existing user (same email) simply becomes the owner.
 */
export async function createShop(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  input: CreateShopInput,
): Promise<{ id: string; ownerEmail: string; newOwner: boolean }> {
  const name = text(input.name).replace(/\s+/g, " ");
  if (!name || name.length > 80)
    throw new PlatformError("Give the shop a name (80 characters at most).", "name");
  const slug = text(input.slug).toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(slug)) {
    throw new PlatformError(
      "Use lower-case letters, digits and dashes for the short name.",
      "slug",
    );
  }
  const address = normalizeHost(text(input.address));
  if (!address) {
    throw new PlatformError(
      "Enter a web address such as tamara.yourplatform.com (no https://).",
      "address",
    );
  }
  const ownerEmail = text(input.ownerEmail).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new PlatformError("Enter the owner's email address.", "ownerEmail");
  }
  const ownerName = text(input.ownerName).slice(0, 100) || ownerEmail.split("@")[0]!;
  const currency = (text(input.currency) || "USD").toUpperCase();
  if (!isCurrencyCode(currency)) throw new PlatformError("Choose a currency.", "currency");
  const timezone = text(input.timezone) || "Asia/Beirut";
  if (safeTimeZone(timezone) !== timezone)
    throw new PlatformError("Choose a time zone.", "timezone");

  const db = getAdminPrisma(adminUrl);
  if (await db.tenant.findUnique({ where: { slug }, select: { id: true } })) {
    throw new PlatformError("That short name is taken.", "slug");
  }
  if (await db.storeDomain.findUnique({ where: { hostname: address }, select: { id: true } })) {
    throw new PlatformError("That web address already belongs to a shop.", "address");
  }
  // An unguessable password nobody knows: the owner chooses theirs from the email.
  const unusable = await hashPassword(randomBytes(32).toString("base64url"));
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name,
        slug,
        stores: { create: [{ name, slug: "main", defaultCurrency: currency, timezone }] },
      },
      select: { id: true, stores: { select: { id: true }, take: 1 } },
    });
    await tx.storeDomain.create({
      data: {
        tenantId: tenant.id,
        storeId: tenant.stores[0]!.id,
        hostname: address,
        isPrimary: true,
      },
    });
    let owner = await tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    const newOwner = !owner;
    if (!owner) {
      owner = await tx.user.create({
        data: { email: ownerEmail, name: ownerName, emailVerified: true },
        select: { id: true },
      });
      await tx.account.create({
        data: {
          userId: owner.id,
          providerId: "credential",
          accountId: owner.id,
          password: unusable,
        },
      });
    }
    const role = await tx.role.findFirstOrThrow({
      where: { tenantId: null, key: "store_owner" },
      select: { id: true },
    });
    await tx.userTenantMembership.create({
      data: { userId: owner.id, tenantId: tenant.id, roleId: role.id },
    });
    await recordAudit(tx, {
      tenantId: tenant.id,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: "platform.shop_created",
      entityType: "tenant",
      entityId: tenant.id,
      after: { name, slug, address, ownerEmail, newOwner },
      ip: actor.ip ?? null,
    });
    return { id: tenant.id, ownerEmail, newOwner };
  });
}

/** Suspends or resumes a shop. Suspended: its website and admin stop answering; nothing is deleted. */
export async function setShopStatus(
  adminUrl: string,
  actor: { userId: string; ip?: string | null },
  id: string,
  status: "active" | "suspended",
  reason?: unknown,
): Promise<void> {
  if (!UUID.test(id)) throw new PlatformError("Shop not found.");
  const note = text(reason).slice(0, 500);
  if (status === "suspended" && !note) {
    throw new PlatformError("Say why the shop is suspended (kept in its record).", "reason");
  }
  const db = getAdminPrisma(adminUrl);
  await db.$transaction(async (tx) => {
    const before = await tx.tenant.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new PlatformError("Shop not found.");
    await tx.tenant.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      tenantId: id,
      actorType: "platform_admin",
      actorUserId: actor.userId,
      action: status === "suspended" ? "platform.shop_suspended" : "platform.shop_resumed",
      entityType: "tenant",
      entityId: id,
      before: { status: before.status },
      after: { status, ...(note ? { reason: note } : {}) },
      ip: actor.ip ?? null,
    });
  });
}
