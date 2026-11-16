import { formatMoney, type Dashboard } from "@ecom/core";
import { Card } from "@ecom/ui";
import Link from "next/link";
import { ORDER_LABEL } from "../orders/_components/order-status";

/**
 * The store at a glance. Every figure is counted from recorded orders (see
 * reports.ts in @ecom/core for what counts as a sale).
 */
export function DashboardView({ data }: { data: Dashboard }) {
  const money = (amount: number) => formatMoney(amount, data.currency);
  const best = Math.max(1, ...data.daily.map((day) => day.sales));
  const dayLabel = new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const when = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: data.timeZone,
  });

  return (
    <div className="flex flex-col gap-6" data-testid="dashboard">
      <section aria-label="Sales" className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ["Today", data.today],
            ["Last 7 days", data.last7Days],
            ["Last 30 days", data.last30Days],
          ] as const
        ).map(([label, figures]) => (
          <div
            key={label}
            className="rounded-card border border-line p-4"
            data-testid={`dashboard-${label.toLowerCase().replace(/ /g, "-")}`}
          >
            <p className="text-sm text-ink-muted">{label}</p>
            <p className="text-2xl font-semibold" data-testid="dashboard-sales">
              {money(figures.sales)}
            </p>
            <p className="text-sm text-ink-muted" data-testid="dashboard-orders">
              {figures.orders} {figures.orders === 1 ? "order" : "orders"}
            </p>
          </div>
        ))}
      </section>

      <section aria-label="To do" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/orders?status=paid"
          className="rounded-card border border-line p-4 hover:bg-surface-muted"
          data-testid="dashboard-to-send"
        >
          <p className="text-sm text-ink-muted">To send</p>
          <p className="text-xl font-semibold">{data.toSend}</p>
          <p className="text-sm text-ink-muted">paid or confirmed, not sent yet</p>
        </Link>
        <Link
          href="/admin/orders?status=fulfilled&payment=cash_on_delivery"
          className="rounded-card border border-line p-4 hover:bg-surface-muted"
          data-testid="dashboard-cash"
        >
          <p className="text-sm text-ink-muted">Cash to collect</p>
          <p className="text-xl font-semibold">{money(data.cashToCollect.amount)}</p>
          <p className="text-sm text-ink-muted">
            {data.cashToCollect.orders} sent {data.cashToCollect.orders === 1 ? "order" : "orders"}
          </p>
        </Link>
        <Link
          href="/admin/orders?status=pending_payment"
          className="rounded-card border border-line p-4 hover:bg-surface-muted"
        >
          <p className="text-sm text-ink-muted">Waiting for payment</p>
          <p className="text-xl font-semibold">{data.awaitingPayment}</p>
          <p className="text-sm text-ink-muted">online, still within time to pay</p>
        </Link>
        <Link
          href="/admin/inventory?low=1"
          className="rounded-card border border-line p-4 hover:bg-surface-muted"
          data-testid="dashboard-low-stock"
        >
          <p className="text-sm text-ink-muted">Low stock</p>
          <p className="text-xl font-semibold">{data.lowStock}</p>
          <p className="text-sm text-ink-muted">products at or below their level</p>
        </Link>
      </section>

      <Card title="Sales, last 14 days">
        <table className="w-full text-sm" data-testid="dashboard-daily">
          <caption className="sr-only">Sales per day, last 14 days</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Sales</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {data.daily.map((day) => (
              <tr key={day.day}>
                <th scope="row" className="w-20 py-1 pr-2 text-left font-normal text-ink-muted">
                  {dayLabel.format(new Date(`${day.day}T00:00:00Z`))}
                </th>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 rounded bg-brand"
                      style={{
                        width: `${Math.round((day.sales / best) * 100)}%`,
                        minWidth: day.sales > 0 ? "0.25rem" : 0,
                      }}
                    />
                    <span className="shrink-0">{money(day.sales)}</span>
                  </div>
                </td>
                <td className="w-20 py-1 text-right text-ink-muted">
                  {day.orders} {day.orders === 1 ? "order" : "orders"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-ink-muted">
          Sales are orders taken (cash orders confirmed or sent, online orders paid) less money
          given back. Days are in the store&rsquo;s time zone ({data.timeZone}).
        </p>
      </Card>

      {data.recent.length > 0 ? (
        <Card title="Latest orders">
          <ul className="flex flex-col divide-y divide-line text-sm" data-testid="dashboard-recent">
            {data.recent.map((order) => (
              <li key={order.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{order.number}
                </Link>
                <span className="text-ink-muted">{order.email}</span>
                <span>{ORDER_LABEL[order.status]}</span>
                <span>{formatMoney(order.totalAmount, order.currency)}</span>
                <span className="text-ink-muted">{when.format(order.placedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
