import { getEnv } from "@ecom/config";
import { listShops } from "@ecom/core";
import { buttonClasses, EmptyState, Field, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/server/access";
import { dollars, StatusBadge, when } from "../parts";

export const metadata: Metadata = { title: "Shops" };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

// Every shop on the platform, searchable, with its main figures.
export default async function ShopsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const search = (first(params.q) ?? "").slice(0, 100);
  const status = first(params.status) ?? "";
  const shops = await listShops(getEnv().DATABASE_ADMIN_URL, { search, status });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shops"
        description={`${shops.length} ${shops.length === 1 ? "shop" : "shops"}`}
        actions={
          <Link href="/admin/platform/shops/new" className={buttonClasses("primary")}>
            New shop
          </Link>
        }
      />
      <div className="flex flex-wrap items-end gap-4">
        <nav aria-label="Filter shops" className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/admin/platform/shops?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(f.value ? { status: f.value } : {}) })}`}
              aria-current={status === f.value ? "page" : undefined}
              className={`rounded-control border px-3 py-1 ${status === f.value ? "border-ink font-medium" : "border-line"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex flex-1 flex-wrap items-end gap-3">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <div className="min-w-48 flex-1">
            <Field
              label="Search"
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Name, short name or web address"
            />
          </div>
          <button type="submit" className={buttonClasses("secondary")}>
            Search
          </button>
        </form>
      </div>

      {shops.length === 0 ? (
        <EmptyState title="No shops here" />
      ) : (
        <div
          className="overflow-x-auto rounded-card border border-line bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Shops table"
        >
          <table className="w-full min-w-[56rem] text-left text-sm" data-testid="platform-shops">
            <thead className="border-b border-line bg-surface-muted text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Shop</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Products</th>
                <th className="px-4 py-3 text-right font-medium">Orders (30 days)</th>
                <th className="px-4 py-3 font-medium">Last order</th>
                <th className="px-4 py-3 text-right font-medium">AI this month</th>
                <th className="px-4 py-3 font-medium">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shops.map((shop) => (
                <tr key={shop.id} data-testid="platform-shop-row">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/platform/shops/${shop.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {shop.name}
                    </Link>
                    <div className="text-xs text-ink-muted">{shop.address ?? shop.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{shop.owner ?? "None"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={shop.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{shop.products}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{shop.orders30d}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {shop.lastOrderAt ? when.format(shop.lastOrderAt) : "None yet"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {dollars(shop.aiCostThisMonthMicros)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{when.format(shop.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
