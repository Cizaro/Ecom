import { listCustomerOrders } from "@ecom/core";
import { EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { OrderStatusBadge } from "../../_components/order-details";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Your orders") };
}

export default async function AccountOrdersPage() {
  const t = await shopT();
  const customer = await requireCustomer("/account/orders");
  const { db } = await storefrontDb();
  const orders = await listCustomerOrders(db, customer.id);
  const date = new Intl.DateTimeFormat(t.intl, { dateStyle: "medium" });

  return (
    <>
      <div>
        <Link href="/account" className="text-sm underline underline-offset-4">
          {t("Back to your account")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("Your orders")}
        </h1>
      </div>
      {orders.length === 0 ? (
        <EmptyState title={t("No orders yet")}>
          {t("Orders you place while signed in appear here.")}
        </EmptyState>
      ) : (
        <ul
          className="flex flex-col divide-y divide-line rounded-card border border-line"
          data-testid="account-orders"
        >
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <Link
                  href={`/account/orders/${order.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {t("Order #{number}", { number: order.number })}
                </Link>
                <p className="text-sm text-ink-muted">
                  {date.format(order.placedAt)} · {t("{count} items", { count: order.itemCount })}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">{t.money(order.totalAmount, order.currency)}</span>
                <OrderStatusBadge status={order.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
