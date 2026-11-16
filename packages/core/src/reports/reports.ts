import { assertPermission, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { moneyToInput } from "../catalog/money";
import { countryName } from "../customers/countries";
import type { ValidAddress } from "../customers/addresses";
import { DEFAULT_LOW_STOCK } from "../inventory/stock";
import {
  listOrders,
  orderWhere,
  storeTimeZoneIn,
  type OrderFilters,
  type OrderSummary,
} from "../orders/orders";
import { addDays, zonedDay, zonedDayStart } from "../platform/time";

// Staff reports: the dashboard and the orders export. Every figure is counted
// from recorded orders inside the store's own tenant; nothing is estimated.
//
// "Sales" are orders the store has taken (cash orders confirmed or sent, and
// online orders paid), at their total less money given back. Cancelled orders
// and online orders still waiting for payment are not sales.

const SALE_STATUSES = ["confirmed", "paid", "fulfilled", "refunded"] as const;

export interface PeriodFigures {
  orders: number;
  /** Minor units of the store currency. */
  sales: number;
}

export interface Dashboard {
  timeZone: string;
  currency: string;
  today: PeriodFigures;
  last7Days: PeriodFigures;
  last30Days: PeriodFigures;
  /** Oldest first: the last 14 days, including today. */
  daily: (PeriodFigures & { day: string })[];
  /** Paid online orders and confirmed cash orders not yet sent. */
  toSend: number;
  /** Cash orders sent whose cash has not been recorded yet. */
  cashToCollect: { orders: number; amount: number };
  /** Online orders waiting for payment, still within their time to pay. */
  awaitingPayment: number;
  /** Counted products at or below their low-stock level (or sold out). */
  lowStock: number;
  recent: OrderSummary[];
}

export async function getDashboard(db: TenantDb, context: RequestContext): Promise<Dashboard> {
  assertPermission(context, "reports.read");
  const { timeZone, currency, rows, counts } = await db.run(async (tx) => {
    const timeZone = await storeTimeZoneIn(tx);
    const store = await tx.store.findFirst({
      select: { defaultCurrency: true },
      orderBy: { createdAt: "asc" },
    });
    const currency = store?.defaultCurrency ?? "USD";
    const today = zonedDay(new Date(), timeZone);
    const since = zonedDayStart(addDays(today, -29), timeZone)!;
    // Per day, in the store's time zone, over the last 30 days.
    const rows = await tx.$queryRaw<{ day: string; orders: bigint; sales: bigint }[]>`
      SELECT to_char(placed_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             count(*) AS orders,
             coalesce(sum(total_amount - refunded_amount), 0) AS sales
        FROM orders
       WHERE placed_at >= ${since}
         AND currency = ${currency}
         AND status::text = ANY(${[...SALE_STATUSES]})
       GROUP BY 1`;
    const [counts] = await tx.$queryRaw<
      {
        to_send: bigint;
        cash_orders: bigint;
        cash_amount: bigint;
        awaiting: bigint;
        low_stock: bigint;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM orders WHERE status IN ('paid', 'confirmed')) AS to_send,
        (SELECT count(*) FROM orders o
          WHERE o.status = 'fulfilled' AND o.payment_method = 'cash_on_delivery'
            AND NOT EXISTS (SELECT 1 FROM payments p
                             WHERE p.order_id = o.id AND p.status = 'succeeded')) AS cash_orders,
        (SELECT coalesce(sum(o.total_amount), 0) FROM orders o
          WHERE o.status = 'fulfilled' AND o.payment_method = 'cash_on_delivery'
            AND NOT EXISTS (SELECT 1 FROM payments p
                             WHERE p.order_id = o.id AND p.status = 'succeeded')) AS cash_amount,
        (SELECT count(*) FROM orders
          WHERE status = 'pending_payment' AND pay_by > now()) AS awaiting,
        (SELECT count(*) FROM product_variants v
          WHERE v.track_inventory
            AND coalesce((SELECT sum(l.on_hand - l.reserved - l.damaged)
                            FROM inventory_levels l WHERE l.variant_id = v.id), 0)
                <= coalesce(v.low_stock_threshold, ${DEFAULT_LOW_STOCK})) AS low_stock`;
    return { timeZone, currency, rows, counts: counts! };
  });

  const byDay = new Map(
    rows.map((row) => [row.day, { orders: Number(row.orders), sales: Number(row.sales) }]),
  );
  const today = zonedDay(new Date(), timeZone);
  const sum = (days: number): PeriodFigures => {
    let orders = 0;
    let sales = 0;
    for (let i = 0; i < days; i += 1) {
      const figures = byDay.get(addDays(today, -i));
      orders += figures?.orders ?? 0;
      sales += figures?.sales ?? 0;
    }
    return { orders, sales };
  };
  const recent = await listOrders(db, context, { page: 1 }).catch(() => ({ items: [] }));

  return {
    timeZone,
    currency,
    today: sum(1),
    last7Days: sum(7),
    last30Days: sum(30),
    daily: Array.from({ length: 14 }, (_, i) => {
      const day = addDays(today, i - 13);
      return { day, ...(byDay.get(day) ?? { orders: 0, sales: 0 }) };
    }),
    toSend: Number(counts.to_send),
    cashToCollect: { orders: Number(counts.cash_orders), amount: Number(counts.cash_amount) },
    awaitingPayment: Number(counts.awaiting),
    lowStock: Number(counts.low_stock),
    recent: recent.items.slice(0, 5),
  };
}

// --- Orders export ---------------------------------------------------------------

export const EXPORT_LIMIT = 5000;

/**
 * One CSV field. Quoted when needed, and a value a spreadsheet would run as a
 * formula (starting with = + - @ or a tab or return) is prefixed with an
 * apostrophe so it shows as text.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADER = [
  "Order",
  "Placed (store time)",
  "Status",
  "Payment",
  "Email",
  "Name",
  "Phone",
  "City",
  "Country",
  "Delivery area",
  "Items",
  "Subtotal",
  "Delivery",
  "Discount",
  "Discount code",
  "Tax added",
  "Total",
  "Refunded",
  "Currency",
] as const;

/**
 * The orders matching the filters as CSV, newest first, at most EXPORT_LIMIT.
 * Holds customers' contact details, so it needs customers.export (as well as
 * orders.read), and every export is written to the audit log.
 */
export async function exportOrdersCsv(
  db: TenantDb,
  context: RequestContext,
  filters: OrderFilters,
): Promise<{ csv: string; count: number; filename: string; truncated: boolean }> {
  assertPermission(context, "orders.read");
  assertPermission(context, "customers.export");
  return db.run(async (tx) => {
    const timeZone = await storeTimeZoneIn(tx);
    const rows = await tx.order.findMany({
      where: orderWhere(filters, timeZone),
      select: {
        number: true,
        placedAt: true,
        status: true,
        paymentMethod: true,
        email: true,
        shippingAddress: true,
        shippingZoneName: true,
        subtotalAmount: true,
        shippingAmount: true,
        discountAmount: true,
        discountCode: true,
        taxAmount: true,
        totalAmount: true,
        refundedAmount: true,
        currency: true,
        items: {
          select: { quantity: true, productName: true, color: true, size: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
      take: EXPORT_LIMIT + 1,
    });
    const truncated = rows.length > EXPORT_LIMIT;
    const kept = rows.slice(0, EXPORT_LIMIT);
    const when = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const lines = [HEADER.join(",")];
    for (const row of kept) {
      const address = row.shippingAddress as unknown as ValidAddress;
      const money = (amount: number) => moneyToInput(amount, row.currency);
      lines.push(
        [
          row.number,
          when.format(row.placedAt).replace(",", ""),
          row.status,
          row.paymentMethod,
          row.email,
          address.fullName,
          address.phone,
          address.city,
          countryName(address.country),
          row.shippingZoneName,
          row.items
            .map((item) => {
              const options = [item.color, item.size].filter(Boolean).join(", ");
              return `${item.quantity} x ${item.productName}${options ? ` (${options})` : ""}`;
            })
            .join("; "),
          money(row.subtotalAmount),
          money(row.shippingAmount),
          money(row.discountAmount),
          row.discountCode,
          money(row.taxAmount),
          money(row.totalAmount),
          money(row.refundedAmount),
          row.currency,
        ]
          .map(csvField)
          .join(","),
      );
    }
    await audit(tx, context, "orders.exported", { type: "order" }, undefined, {
      count: kept.length,
      filters: {
        status: filters.status ?? null,
        search: filters.search ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
        paymentMethod: filters.paymentMethod ?? null,
      },
    });
    const stamp = zonedDay(new Date(), timeZone);
    return {
      // A byte-order mark so spreadsheet programs read accented names correctly.
      csv: `\uFEFF${lines.join("\r\n")}\r\n`,
      count: kept.length,
      filename: `orders-${stamp}.csv`,
      truncated,
    };
  });
}
