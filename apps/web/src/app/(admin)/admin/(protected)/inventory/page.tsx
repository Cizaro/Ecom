import { hasPermission, listStock } from "@ecom/core";
import { buttonClasses, Checkbox, EmptyState, Field, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { StockBadge } from "./_components/stock-badge";

export const metadata: Metadata = { title: "Stock" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("inventory.read");
  const params = await searchParams;
  const search = (first(params.q) ?? "").slice(0, 100);
  const lowOnly = first(params.low) === "1";
  const page = Math.min(10_000, Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1));
  const result = await listStock(tenantDb(context), context, { search, lowOnly, page });

  const pageLink = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (lowOnly) query.set("low", "1");
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/admin/inventory?${text}` : "/admin/inventory";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock"
        description="Items whose stock is counted, the fewest left first."
        actions={
          <Link href="/admin/inventory/locations" className={buttonClasses("secondary")}>
            Locations
          </Link>
        }
      />
      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field
          label="Search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Name or SKU"
        />
        <Checkbox label="Low or out of stock only" name="low" value="1" defaultChecked={lowOnly} />
        <button type="submit" className={buttonClasses("secondary")}>
          Filter
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title={lowOnly ? "Nothing is running low" : "No counted stock yet"}>
          {lowOnly || search ? (
            <Link href="/admin/inventory" className="underline underline-offset-4">
              Show everything
            </Link>
          ) : (
            "New variants are counted from the start; receive stock on each item's page."
          )}
        </EmptyState>
      ) : (
        <List testId="stock-list">
          {result.items.map((row) => (
            <ListItem key={row.variantId} testId="stock-row">
              <div className="min-w-0">
                <Link
                  href={`/admin/inventory/${row.variantId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.productName}
                </Link>
                <p className="truncate text-sm text-ink-muted">
                  {[row.sku, row.color, row.size].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                <span data-testid="stock-available">
                  <span className="font-medium text-ink">{row.available}</span> available
                </span>
                {row.reserved > 0 ? <span>{row.reserved} held</span> : null}
                {row.damaged > 0 ? <span>{row.damaged} damaged</span> : null}
                <StockBadge status={row.status} />
              </div>
            </ListItem>
          ))}
        </List>
      )}

      {result.pageCount > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {result.page > 1 ? (
            <Link href={pageLink(result.page - 1)} className={buttonClasses("secondary")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link href={pageLink(result.page + 1)} className={buttonClasses("secondary")}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      {hasPermission(context, "inventory.adjust") ? null : (
        <p className="text-sm text-ink-muted">Your role can see stock but not change it.</p>
      )}
    </div>
  );
}
