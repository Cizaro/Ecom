import { listCustomers, type CustomerSummary } from "@ecom/core";
import { Badge, buttonClasses, EmptyState, Field, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";

export const metadata: Metadata = { title: "Customers" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function accountLabel(customer: CustomerSummary): {
  label: string;
  tone: "neutral" | "success" | "warning";
} {
  if (customer.status === "disabled") return { label: "Disabled", tone: "warning" };
  if (!customer.hasAccount) return { label: "Guest", tone: "neutral" };
  if (!customer.emailVerified) return { label: "Not confirmed", tone: "warning" };
  return { label: "Account", tone: "success" };
}

// Read-only for now: profiles, notes and data requests come with the customer
// tools later in Phase 3. Password material is never loaded.
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("customers.read");
  const params = await searchParams;
  const search = (first(params.q) ?? "").slice(0, 100);
  const page = Math.min(10_000, Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1));
  const result = await listCustomers(tenantDb(context), context, { search, page });

  const pageLink = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/admin/customers?${text}` : "/admin/customers";
  };
  const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description={`${result.total} ${result.total === 1 ? "customer" : "customers"}${search ? " match" : ""} in ${context.tenantName}.`}
      />
      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field
          label="Search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Email or name"
        />
        <button type="submit" className={buttonClasses("secondary")}>
          Search
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title={search ? "No customers match" : "No customers yet"}>
          {search ? (
            <Link href="/admin/customers" className="underline underline-offset-4">
              Clear the search
            </Link>
          ) : (
            "Shoppers appear here when they create an account."
          )}
        </EmptyState>
      ) : (
        <List testId="customer-list">
          {result.items.map((customer) => {
            const status = accountLabel(customer);
            return (
              <ListItem key={customer.id} testId="customer-row">
                <div className="min-w-0">
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="block truncate font-medium underline-offset-4 hover:underline"
                    data-testid="customer-email"
                  >
                    {customer.email}
                  </Link>
                  <p className="truncate text-sm text-ink-muted">
                    {customer.name || "No name given"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                  <span>Since {dateFormat.format(customer.createdAt)}</span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
              </ListItem>
            );
          })}
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
    </div>
  );
}
