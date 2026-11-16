import {
  formatMoney,
  hasPermission,
  isCalendarDate,
  listOrders,
  ORDER_STATUSES,
  PAYMENT_METHODS,
} from "@ecom/core";
import {
  Badge,
  buttonClasses,
  EmptyState,
  Field,
  List,
  ListItem,
  PageHeader,
  Select,
} from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ORDER_LABEL, ORDER_TONE } from "./_components/order-status";

export const metadata: Metadata = { title: "Orders" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("orders.read");
  const params = await searchParams;
  const search = (first(params.q) ?? "").slice(0, 100);
  const status = ORDER_STATUSES.find((value) => value === first(params.status));
  const payment = PAYMENT_METHODS.find((value) => value === first(params.payment));
  const dayParam = (name: string) => {
    const value = first(params[name]) ?? "";
    return isCalendarDate(value) ? value : "";
  };
  const from = dayParam("from");
  const to = dayParam("to");
  const page = Math.min(10_000, Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1));
  const result = await listOrders(tenantDb(context), context, {
    search,
    status,
    paymentMethod: payment,
    from: from || undefined,
    to: to || undefined,
    page,
  });
  const filtered = Boolean(search || status || payment || from || to);
  const canExport = hasPermission(context, "customers.export");
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  const pageLink = (target: number) => {
    const query = filterQuery();
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/admin/orders?${text}` : "/admin/orders";
  };
  function filterQuery() {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (status) query.set("status", status);
    if (payment) query.set("payment", payment);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    return query;
  }
  const exportQuery = filterQuery().toString();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description={`${result.total} ${result.total === 1 ? "order" : "orders"}${filtered ? " match" : ""}.`}
      />
      <form
        method="get"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_10rem_10rem_auto] lg:items-end"
        data-testid="order-filters"
      >
        <Field
          label="Search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Order number or email"
        />
        <Select
          label="Status"
          name="status"
          defaultValue={status ?? ""}
          options={[
            { value: "", label: "Any status" },
            ...ORDER_STATUSES.map((value) => ({ value, label: ORDER_LABEL[value] })),
          ]}
        />
        <Select
          label="Payment"
          name="payment"
          defaultValue={payment ?? ""}
          options={[
            { value: "", label: "Any payment" },
            { value: "cash_on_delivery", label: "Cash on delivery" },
            { value: "online", label: "Online" },
          ]}
        />
        <Field label="From" name="from" type="date" defaultValue={from} />
        <Field label="To" name="to" type="date" defaultValue={to} />
        <button type="submit" className={buttonClasses("secondary")}>
          Filter
        </button>
      </form>
      {canExport ? (
        <p className="text-sm">
          <a
            href={`/api/v1/admin/orders/export${exportQuery ? `?${exportQuery}` : ""}`}
            className="underline underline-offset-4"
            data-testid="export-orders"
          >
            Download these orders as CSV
          </a>{" "}
          <span className="text-ink-muted">
            (up to 5,000; includes customers&rsquo; contact details)
          </span>
        </p>
      ) : null}

      {result.items.length === 0 ? (
        <EmptyState title={filtered ? "No orders match" : "No orders yet"} />
      ) : (
        <List testId="order-list">
          {result.items.map((order) => (
            <ListItem key={order.id} testId="order-row">
              <div className="min-w-0">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{order.number}
                </Link>
                <p className="truncate text-sm text-ink-muted">
                  {order.email} · {when.format(order.placedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                </span>
                <span className="font-medium">
                  {formatMoney(order.totalAmount, order.currency)}
                </span>
                <Badge tone={ORDER_TONE[order.status]}>{ORDER_LABEL[order.status]}</Badge>
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
    </div>
  );
}
