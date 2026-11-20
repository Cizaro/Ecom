import {
  formatMoney,
  getAnalyticsReport,
  hasPermission,
  percent,
  REPORT_PERIODS,
  reportPeriod,
} from "@ecom/core";
import { Badge, buttonClasses, Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { AskForm } from "./ask-form";
import { Bars, Funnel, SalesChart } from "./charts";

export const metadata: Metadata = { title: "Reports" };

// Reports (Milestone 7.4): sales, products, categories, the shop funnel,
// searches, campaigns, a sales forecast and what will run out. Every figure is
// counted from the store's own records (see analytics/report.ts in @ecom/core).

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { context } = await requirePermission("reports.read");
  const days = reportPeriod((await searchParams).days);
  const report = await getAnalyticsReport(tenantDb(context), context, days);
  const money = (minor: number) => formatMoney(minor, report.currency);
  const canAsk = hasPermission(context, "ai.use");
  const s = report.summary;
  const change = percent(Math.abs(s.sales - report.previous.sales), report.previous.sales);
  const up = s.sales >= report.previous.sales;

  const tiles: { label: string; value: string; note: string; testId: string }[] = [
    {
      label: "Sales",
      value: money(s.sales),
      note:
        change === null
          ? "nothing in the period before"
          : `${up ? "up" : "down"} ${change}% on the ${days} days before`,
      testId: "reports-sales",
    },
    {
      label: "Orders",
      value: String(s.orders),
      note: `${s.units} units`,
      testId: "reports-orders",
    },
    {
      label: "Average order",
      value: money(s.averageOrder),
      note: `${money(s.discounts)} in discounts`,
      testId: "reports-average",
    },
    {
      label: "Customers",
      value: String(s.newCustomers + s.returningCustomers),
      note: `${s.newCustomers} new, ${s.returningCustomers} returning, ${s.guestOrders} guest orders`,
      testId: "reports-customers",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description={`${report.from} to ${report.to}, in the store's time zone (${report.timeZone}).`}
        actions={
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {REPORT_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/admin/reports?days=${p}`}
                aria-current={p === days ? "page" : undefined}
                className={buttonClasses(p === days ? "primary" : "secondary")}
              >
                {p} days
              </Link>
            ))}
          </nav>
        }
      />

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-card border border-line bg-surface p-4"
            data-testid={t.testId}
          >
            <p className="text-sm text-ink-muted">{t.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
            <p className="text-sm text-ink-muted">{t.note}</p>
          </div>
        ))}
      </section>

      <Card title="Sales per day">
        <SalesChart report={report} money={money} />
        {report.forecast.enough ? (
          <p className="text-sm" data-testid="reports-forecast">
            Expected in the next 14 days: <strong>{money(report.forecast.total.expected)}</strong>,
            likely between {money(report.forecast.total.low)} and{" "}
            {money(report.forecast.total.high)}.
          </p>
        ) : null}
      </Card>

      {canAsk ? (
        <Card
          title="Ask about these figures"
          description="The AI answers only from the figures on this page and shows which ones it used. It never calculates new numbers."
        >
          <AskForm days={days} />
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="From view to order"
          description="Visits counted on this store's own pages; crawlers are left out."
        >
          <Funnel funnel={report.funnel} />
        </Card>
        <Card title="Sales by category">
          {report.categories.length === 0 ? (
            <p className="text-sm text-ink-muted">No sales in this period.</p>
          ) : (
            <Bars
              testId="reports-categories"
              rows={report.categories.map((c) => ({
                label: c.name,
                value: c.revenue,
                note: `${c.units} units`,
              }))}
              format={money}
            />
          )}
        </Card>
      </div>

      <Card
        title="Top products"
        description="By sales in the period, with how often each was viewed and added to a cart."
      >
        {report.topProducts.length === 0 ? (
          <EmptyState title="No sales in this period">
            Sales appear here once orders are placed.
          </EmptyState>
        ) : (
          <>
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Top products table"
            >
              <table className="w-full min-w-[520px] text-sm" data-testid="reports-products">
                <thead>
                  <tr className="border-b border-line text-left text-ink-muted">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 text-right font-medium">Units</th>
                    <th className="py-2 pr-3 text-right font-medium">Sales</th>
                    <th className="py-2 pr-3 text-right font-medium">Views</th>
                    <th className="py-2 text-right font-medium">Added to cart</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topProducts.map((p) => (
                    <tr key={p.name} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3">{p.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.units}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(p.revenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.views}</td>
                      <td className="py-2 text-right tabular-nums">{p.addsToCart}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <a
                href={`/api/v1/admin/reports/products?days=${days}`}
                className={buttonClasses("secondary")}
                data-testid="reports-products-csv"
              >
                Download as CSV
              </a>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="What shoppers searched for"
          description="Searches that found nothing show what to stock or how to name things."
        >
          {report.searches.length === 0 ? (
            <p className="text-sm text-ink-muted">No searches in this period.</p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-line text-sm"
              data-testid="reports-searches"
            >
              {report.searches.map((q) => (
                <li key={q.query} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    “{q.query}” {q.noResults ? <Badge tone="warning">found nothing</Badge> : null}
                  </span>
                  <span className="tabular-nums text-ink-muted">{q.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Campaigns"
          description="Tracking-link clicks and orders that used the campaign's discount code."
        >
          {report.campaigns.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No campaign clicks or code orders in this period.
            </p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-line text-sm"
              data-testid="reports-campaigns"
            >
              {report.campaigns.map((c) => (
                <li key={c.name} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="tabular-nums text-ink-muted">
                    {c.clicks} clicks · {c.orders} orders · {money(c.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Running out soon"
        description="At the pace of the last 28 days, these will run out within 3 weeks."
      >
        {report.runningOut.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing is running out at the current pace.</p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-line text-sm"
            data-testid="reports-running-out"
          >
            {report.runningOut.map((r) => (
              <li
                key={r.variantId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <span>
                  <span className="font-medium">{r.productName}</span>{" "}
                  <span className="text-ink-muted">{r.sku}</span>
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-ink-muted">
                    {r.available} left · {r.soldLast28Days} sold in 28 days
                  </span>
                  <Badge tone={r.daysLeft <= 7 ? "warning" : "neutral"}>
                    {r.daysLeft === 0 ? "out now" : `about ${r.daysLeft} days`}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Link href="/admin/inventory?low=1" className="text-sm underline underline-offset-4">
            Open inventory
          </Link>
        </div>
      </Card>
    </div>
  );
}
