import { getEnv } from "@ecom/config";
import { platformOverview } from "@ecom/core";
import { buttonClasses, Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/server/access";
import { DailyBars, dollars, money, Stat, StatusBadge, when } from "./parts";

export const metadata: Metadata = { title: "Dashboard" };

// The platform at a glance: shops, sales across them, AI cost, activity.
export default async function PlatformDashboard() {
  await requirePlatformAdmin();
  const o = await platformOverview(getEnv().DATABASE_ADMIN_URL);
  const salesOrders = o.salesThisMonth.reduce((sum, s) => sum + s.orders, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Every shop on your platform, at a glance."
        actions={
          <Link href="/admin/platform/shops/new" className={buttonClasses("primary")}>
            New shop
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="platform-stats">
        <Stat
          label="Shops"
          value={o.shops.total}
          hint={`${o.shops.active} active · ${o.shops.suspended} suspended`}
          testId="stat-shops"
        />
        <Stat label="New this month" value={o.shops.newThisMonth} />
        <Stat
          label="Sales this month"
          value={money(o.salesThisMonth)}
          hint={`${salesOrders} orders across all shops`}
        />
        <Stat
          label="AI cost this month"
          value={dollars(o.aiCostThisMonthMicros)}
          hint={`${o.staff} staff accounts`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card title="Orders, all shops, last 14 days">
          <DailyBars series={o.ordersPerDay} label="Orders per day, all shops" />
        </Card>
        <Card title="Busiest shops (30 days)">
          {o.busiest.length === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {o.busiest.map((shop) => (
                <li key={shop.id} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/platform/shops/${shop.id}`}
                    className="truncate underline-offset-4 hover:underline"
                  >
                    {shop.name}
                  </Link>
                  <span className="tabular-nums text-ink-muted">{shop.orders} orders</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Newest shops">
        <ul className="flex flex-col divide-y divide-line text-sm">
          {o.newest.map((shop) => (
            <li key={shop.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link
                href={`/admin/platform/shops/${shop.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {shop.name}
              </Link>
              <span className="flex items-center gap-3 text-ink-muted">
                <StatusBadge status={shop.status} />
                {when.format(shop.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
