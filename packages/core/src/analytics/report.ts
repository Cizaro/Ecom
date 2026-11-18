import type { AiGateway, Fact, KnowledgeSource, ReportQuestionOutput, RunResult } from "@ecom/ai";
import { assertPermission, type RequestContext } from "../access/context";
import type { TenantDb } from "../access/tenant-db";
import { getBusinessProfile } from "../ai/ai-admin";
import { formatMoney } from "../catalog/money";
import { storeTimeZoneIn } from "../orders/orders";
import { addDays, zonedDay, zonedDayStart } from "../platform/time";
import { csvField } from "../reports/reports";
import {
  forecastSales,
  percent,
  stockRunOut,
  type DayFigures,
  type RunOut,
  type SalesForecast,
} from "./forecast";

// The reports page (Milestone 7.4, decisions D109 and D110). Every figure is
// counted from the store's own records inside its tenant: orders for sales,
// shop events for views, carts, checkouts, searches and link clicks. A "sale"
// is the same as on the dashboard: cash orders confirmed or sent, online
// orders paid, at their total less refunds.

const SALE_STATUSES = ["confirmed", "paid", "fulfilled", "refunded"];
export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function reportPeriod(value: unknown): ReportPeriod {
  const n = Number(value);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportPeriod) : 30;
}

export interface ProductRow {
  name: string;
  units: number;
  revenue: number;
  views: number;
  addsToCart: number;
}

export interface AnalyticsReport {
  days: ReportPeriod;
  from: string;
  to: string;
  timeZone: string;
  currency: string;
  summary: {
    orders: number;
    sales: number;
    units: number;
    averageOrder: number;
    discounts: number;
    refunded: number;
    newCustomers: number;
    returningCustomers: number;
    guestOrders: number;
  };
  /** The same summary for the period before, for comparison. */
  previous: { orders: number; sales: number };
  daily: DayFigures[];
  topProducts: ProductRow[];
  categories: { name: string; revenue: number; units: number }[];
  funnel: { views: number; addsToCart: number; checkouts: number; orders: number };
  searches: { query: string; count: number; noResults: boolean }[];
  campaigns: { name: string; clicks: number; orders: number; revenue: number }[];
  forecast: SalesForecast;
  runningOut: RunOut[];
}

const n = (value: bigint | number | null | undefined) => Number(value ?? 0);

export async function getAnalyticsReport(
  db: TenantDb,
  context: RequestContext,
  daysInput: unknown,
  now = new Date(),
): Promise<AnalyticsReport> {
  assertPermission(context, "reports.read");
  const days = reportPeriod(daysInput);
  return db.run(async (tx) => {
    const timeZone = await storeTimeZoneIn(tx);
    const store = await tx.store.findFirst({
      select: { defaultCurrency: true },
      orderBy: { createdAt: "asc" },
    });
    const currency = store?.defaultCurrency ?? "USD";
    const today = zonedDay(now, timeZone);
    const from = addDays(today, -(days - 1));
    const since = zonedDayStart(from, timeZone)!;
    const before = zonedDayStart(addDays(from, -days), timeZone)!;
    const historyFrom = addDays(today, -55);
    const historySince = zonedDayStart(addDays(today, -Math.max(55, days - 1)), timeZone)!;
    const since28 = zonedDayStart(addDays(today, -27), timeZone)!;

    const dailyRows = await tx.$queryRaw<{ day: string; orders: bigint; sales: bigint }[]>`
      SELECT to_char(placed_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             count(*) AS orders,
             coalesce(sum(total_amount - refunded_amount), 0) AS sales
        FROM orders
       WHERE placed_at >= ${historySince} AND currency = ${currency}
         AND status::text = ANY(${SALE_STATUSES})
       GROUP BY 1`;

    const [summary] = await tx.$queryRaw<
      {
        orders: bigint;
        sales: bigint;
        discounts: bigint;
        refunded: bigint;
        units: bigint;
        new_customers: bigint;
        returning: bigint;
        guests: bigint;
      }[]
    >`
      WITH period AS (
        SELECT * FROM orders
         WHERE placed_at >= ${since} AND currency = ${currency}
           AND status::text = ANY(${SALE_STATUSES})
      )
      SELECT count(*) AS orders,
             coalesce(sum(total_amount - refunded_amount), 0) AS sales,
             coalesce(sum(discount_amount), 0) AS discounts,
             coalesce(sum(refunded_amount), 0) AS refunded,
             (SELECT coalesce(sum(i.quantity), 0) FROM order_items i WHERE i.order_id IN (SELECT id FROM period)) AS units,
             (SELECT count(DISTINCT p.customer_id) FROM period p WHERE p.customer_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = p.customer_id
                                 AND o.placed_at < ${since} AND o.status::text = ANY(${SALE_STATUSES}))) AS new_customers,
             (SELECT count(DISTINCT p.customer_id) FROM period p WHERE p.customer_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = p.customer_id
                             AND o.placed_at < ${since} AND o.status::text = ANY(${SALE_STATUSES}))) AS returning,
             (SELECT count(*) FROM period WHERE customer_id IS NULL) AS guests
        FROM period`;

    const [previous] = await tx.$queryRaw<{ orders: bigint; sales: bigint }[]>`
      SELECT count(*) AS orders, coalesce(sum(total_amount - refunded_amount), 0) AS sales
        FROM orders
       WHERE placed_at >= ${before} AND placed_at < ${since} AND currency = ${currency}
         AND status::text = ANY(${SALE_STATUSES})`;

    const products = await tx.$queryRaw<
      { product_id: string | null; name: string; units: bigint; revenue: bigint }[]
    >`
      SELECT v.product_id, coalesce(max(p.name), max(i.product_name)) AS name,
             sum(i.quantity) AS units, sum(i.line_total_amount) AS revenue
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        LEFT JOIN product_variants v ON v.id = i.variant_id
        LEFT JOIN products p ON p.id = v.product_id
       WHERE o.placed_at >= ${since} AND o.currency = ${currency}
         AND o.status::text = ANY(${SALE_STATUSES})
       GROUP BY v.product_id, CASE WHEN v.product_id IS NULL THEN i.product_name END
       ORDER BY revenue DESC
       LIMIT 10`;

    const productEvents = await tx.$queryRaw<{ product_id: string; name: string; count: bigint }[]>`
      SELECT product_id, name, count(*) AS count FROM analytics_events
       WHERE occurred_at >= ${since} AND product_id IS NOT NULL
         AND name IN ('product_view', 'add_to_cart')
       GROUP BY product_id, name`;

    const categories = await tx.$queryRaw<
      { name: string | null; units: bigint; revenue: bigint }[]
    >`
      SELECT c.name, sum(i.quantity) AS units, sum(i.line_total_amount) AS revenue
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        LEFT JOIN product_variants v ON v.id = i.variant_id
        LEFT JOIN products p ON p.id = v.product_id
        LEFT JOIN categories c ON c.id = p.category_id
       WHERE o.placed_at >= ${since} AND o.currency = ${currency}
         AND o.status::text = ANY(${SALE_STATUSES})
       GROUP BY c.name
       ORDER BY revenue DESC
       LIMIT 12`;

    const funnelRows = await tx.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT name, count(*) AS count FROM analytics_events
       WHERE occurred_at >= ${since} AND name IN ('product_view', 'add_to_cart', 'checkout_started')
       GROUP BY name`;
    const [placed] = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM orders WHERE placed_at >= ${since}`;

    const searches = await tx.$queryRaw<{ query: string; count: bigint; no_results: boolean }[]>`
      SELECT query, count(*) AS count, bool_and(result_count = 0) AS no_results
        FROM analytics_events
       WHERE occurred_at >= ${since} AND name = 'search'
       GROUP BY query
       ORDER BY count DESC, query
       LIMIT 15`;

    const campaigns = await tx.$queryRaw<
      { name: string; clicks: bigint; orders: bigint; revenue: bigint }[]
    >`
      SELECT c.name,
             (SELECT count(*) FROM analytics_events e JOIN utm_links l ON l.id = e.utm_link_id
               WHERE l.campaign_id = c.id AND e.name = 'link_click' AND e.occurred_at >= ${since}) AS clicks,
             (SELECT count(*) FROM discount_redemptions r JOIN orders o ON o.id = r.order_id
               WHERE r.code_id = c.discount_code_id AND o.placed_at >= ${since}
                 AND o.status::text = ANY(${SALE_STATUSES})) AS orders,
             (SELECT coalesce(sum(o.total_amount - o.refunded_amount), 0)
                FROM discount_redemptions r JOIN orders o ON o.id = r.order_id
               WHERE r.code_id = c.discount_code_id AND o.placed_at >= ${since}
                 AND o.status::text = ANY(${SALE_STATUSES})) AS revenue
        FROM marketing_campaigns c
       ORDER BY c.starts_on DESC
       LIMIT 20`;

    const stock = await tx.$queryRaw<
      { variant_id: string; product_name: string; sku: string; available: bigint; sold: bigint }[]
    >`
      SELECT v.id AS variant_id, p.name AS product_name, v.sku,
             coalesce((SELECT sum(l.on_hand - l.reserved - l.damaged) FROM inventory_levels l
                        WHERE l.variant_id = v.id), 0) AS available,
             coalesce((SELECT sum(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id
                        WHERE i.variant_id = v.id AND o.placed_at >= ${since28}
                          AND o.status::text = ANY(${SALE_STATUSES})), 0) AS sold
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
       WHERE v.track_inventory AND p.status = 'active'`;

    // Assemble.
    const byDay = new Map(
      dailyRows.map((r) => [r.day, { orders: n(r.orders), sales: n(r.sales) }]),
    );
    const series = (start: string, end: string) => {
      const out: DayFigures[] = [];
      for (let d = start; d <= end; d = addDays(d, 1)) {
        out.push({ day: d, ...(byDay.get(d) ?? { orders: 0, sales: 0 }) });
      }
      return out;
    };
    const views = new Map<string, number>();
    const adds = new Map<string, number>();
    for (const row of productEvents) {
      (row.name === "product_view" ? views : adds).set(row.product_id, n(row.count));
    }
    const funnel = new Map(funnelRows.map((r) => [r.name, n(r.count)]));
    const orders = n(summary?.orders);
    const sales = n(summary?.sales);

    return {
      days,
      from,
      to: today,
      timeZone,
      currency,
      summary: {
        orders,
        sales,
        units: n(summary?.units),
        averageOrder: orders > 0 ? Math.round(sales / orders) : 0,
        discounts: n(summary?.discounts),
        refunded: n(summary?.refunded),
        newCustomers: n(summary?.new_customers),
        returningCustomers: n(summary?.returning),
        guestOrders: n(summary?.guests),
      },
      previous: { orders: n(previous?.orders), sales: n(previous?.sales) },
      daily: series(from, today),
      topProducts: products.map((p) => ({
        name: p.name,
        units: n(p.units),
        revenue: n(p.revenue),
        views: p.product_id ? (views.get(p.product_id) ?? 0) : 0,
        addsToCart: p.product_id ? (adds.get(p.product_id) ?? 0) : 0,
      })),
      categories: categories.map((c) => ({
        name: c.name ?? "No category",
        units: n(c.units),
        revenue: n(c.revenue),
      })),
      funnel: {
        views: funnel.get("product_view") ?? 0,
        addsToCart: funnel.get("add_to_cart") ?? 0,
        checkouts: funnel.get("checkout_started") ?? 0,
        orders: n(placed?.count),
      },
      searches: searches.map((s) => ({
        query: s.query,
        count: n(s.count),
        noResults: s.no_results,
      })),
      campaigns: campaigns
        .map((c) => ({
          name: c.name,
          clicks: n(c.clicks),
          orders: n(c.orders),
          revenue: n(c.revenue),
        }))
        .filter((c) => c.clicks > 0 || c.orders > 0),
      forecast: forecastSales(series(historyFrom, today), today),
      runningOut: stockRunOut(
        stock.map((s) => ({
          variantId: s.variant_id,
          productName: s.product_name,
          sku: s.sku,
          available: n(s.available),
          soldLast28Days: n(s.sold),
        })),
      ).slice(0, 15),
    };
  });
}

// --- Facts for questions ------------------------------------------------------------

/**
 * The report as numbered facts, each a plain sentence with its figures
 * already worked out, so an answer never has to calculate (decision D110).
 */
export function reportFacts(report: AnalyticsReport): Fact[] {
  const money = (amount: number) => formatMoney(amount, report.currency);
  const period = `from ${report.from} to ${report.to} (${report.days} days)`;
  const s = report.summary;
  const facts: Fact[] = [
    {
      id: "summary:sales",
      kind: "summary",
      text: `Sales ${period}: ${money(s.sales)} from ${s.orders} orders.`,
    },
    {
      id: "summary:previous",
      kind: "summary",
      text: `The ${report.days} days before that: ${money(report.previous.sales)} from ${report.previous.orders} orders.`,
    },
    {
      id: "summary:average",
      kind: "summary",
      text: `Average order ${period}: ${money(s.averageOrder)}.`,
    },
    { id: "summary:units", kind: "summary", text: `Units sold ${period}: ${s.units}.` },
    {
      id: "summary:customers",
      kind: "summary",
      text: `Customers ${period}: ${s.newCustomers} ordered for the first time, ${s.returningCustomers} had ordered before, and ${s.guestOrders} orders were from guests without an account.`,
    },
    {
      id: "summary:discounts",
      kind: "summary",
      text: `Discounts given ${period}: ${money(s.discounts)}. Refunded: ${money(s.refunded)}.`,
    },
  ];
  const change = percent(Math.abs(s.sales - report.previous.sales), report.previous.sales);
  if (change !== null) {
    facts.push({
      id: "summary:change",
      kind: "summary",
      text: `Sales ${s.sales >= report.previous.sales ? "rose" : "fell"} by ${change}% compared with the ${report.days} days before.`,
    });
  }
  const best = [...report.daily].sort((a, b) => b.sales - a.sales)[0];
  if (best && best.sales > 0) {
    facts.push({
      id: "daily:best",
      kind: "daily",
      text: `Best day ${period}: ${best.day} with ${money(best.sales)} from ${best.orders} orders.`,
    });
  }
  report.topProducts.forEach((p, i) => {
    facts.push({
      id: `product:${i + 1}`,
      kind: "product",
      text: `Number ${i + 1} by sales ${period}: ${p.name}, ${money(p.revenue)} from ${p.units} units; viewed ${p.views} times and added to carts ${p.addsToCart} times.`,
    });
  });
  report.categories.forEach((c, i) => {
    facts.push({
      id: `category:${i + 1}`,
      kind: "category",
      text: `Category ${c.name} ${period}: ${money(c.revenue)} from ${c.units} units.`,
    });
  });
  const f = report.funnel;
  facts.push({
    id: "funnel",
    kind: "funnel",
    text: `Shop visits ${period}: ${f.views} product views, ${f.addsToCart} adds to cart, ${f.checkouts} checkouts started, ${f.orders} orders placed.`,
  });
  const viewToCart = percent(f.addsToCart, f.views);
  const cartToOrder = percent(f.orders, f.addsToCart);
  if (viewToCart !== null)
    facts.push({
      id: "funnel:view-to-cart",
      kind: "funnel",
      text: `${viewToCart}% of product views led to an add to cart.`,
    });
  if (cartToOrder !== null)
    facts.push({
      id: "funnel:cart-to-order",
      kind: "funnel",
      text: `There were ${cartToOrder} orders for every 100 adds to cart.`,
    });
  report.searches.slice(0, 10).forEach((q, i) => {
    facts.push({
      id: `search:${i + 1}`,
      kind: "search",
      text: `Search "${q.query}" ${period}: ${q.count} times${q.noResults ? ", and it found nothing" : ""}.`,
    });
  });
  report.campaigns.forEach((c, i) => {
    facts.push({
      id: `campaign:${i + 1}`,
      kind: "campaign",
      text: `Campaign ${c.name} ${period}: ${c.clicks} tracking-link clicks, ${c.orders} orders with its discount code worth ${money(c.revenue)}.`,
    });
  });
  if (report.forecast.enough) {
    const t = report.forecast.total;
    facts.push({
      id: "forecast",
      kind: "forecast",
      text: `Expected sales for the next 14 days at the recent weekday pattern: about ${money(t.expected)}, likely between ${money(t.low)} and ${money(t.high)}.`,
    });
  } else {
    facts.push({
      id: "forecast",
      kind: "forecast",
      text: "There is not enough sales history yet to forecast the next 14 days.",
    });
  }
  report.runningOut.slice(0, 10).forEach((r, i) => {
    facts.push({
      id: `stock:${i + 1}`,
      kind: "stock",
      text:
        r.daysLeft === 0
          ? `${r.productName} (${r.sku}) has run out; it sold ${r.soldLast28Days} in the last 28 days.`
          : `${r.productName} (${r.sku}) will run out in about ${r.daysLeft} days at the recent pace (${r.available} left, ${r.soldLast28Days} sold in the last 28 days).`,
    });
  });
  return facts;
}

const NO_KNOWLEDGE: KnowledgeSource = { abilities: () => [], search: async () => [] };

/** Staff ask about the report in their own words; the answer uses only its facts. */
export async function askAboutReport(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  input: { question: unknown; days: unknown; language?: string },
): Promise<{ result: RunResult<ReportQuestionOutput>; facts: Fact[] }> {
  assertPermission(context, "reports.read");
  assertPermission(context, "ai.use");
  const [report, profile] = await Promise.all([
    getAnalyticsReport(db, context, input.days),
    getBusinessProfile(db),
  ]);
  const facts = reportFacts(report);
  const result = await gateway.run(
    "report.question",
    {
      language: input.language ?? "en",
      question: typeof input.question === "string" ? input.question : "",
      facts: facts.map((f) => ({ id: f.id, text: f.text })),
    },
    { tenantId: db.tenantId, profile, knowledge: NO_KNOWLEDGE },
  );
  return { result, facts };
}

// --- CSV ------------------------------------------------------------------------------

/** The report's product table as CSV (money in the store currency, two decimals). */
export function productsCsv(report: AnalyticsReport): { csv: string; filename: string } {
  const amount = (minor: number) => (minor / 100).toFixed(2);
  const lines = [
    ["Product", "Units", `Sales (${report.currency})`, "Views", "Added to cart"]
      .map(csvField)
      .join(","),
    ...report.topProducts.map((p) =>
      [p.name, p.units, amount(p.revenue), p.views, p.addsToCart].map(csvField).join(","),
    ),
  ];
  return {
    csv: `${lines.join("\r\n")}\r\n`,
    filename: `products-${report.from}-to-${report.to}.csv`,
  };
}
