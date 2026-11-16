import { formatMoney, listCustomerOrders } from "@ecom/core";
import { EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { OrderStatusBadge } from "../../_components/order-details";

export const metadata: Metadata = { title: "Your orders" };

export default async function AccountOrdersPage() {
  const customer = await requireCustomer("/account/orders");
  const { db } = await storefrontDb();
  const orders = await listCustomerOrders(db, customer.id);
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

  return (
    <>
      <div>
        <Link href="/account" className="text-sm underline underline-offset-4">
          Back to your account
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your orders</h1>
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet">Orders you place while signed in appear here.</EmptyState>
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
                  Order #{order.number}
                </Link>
                <p className="text-sm text-ink-muted">
                  {date.format(order.placedAt)} · {order.itemCount}{" "}
                  {order.itemCount === 1 ? "item" : "items"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">
                  {formatMoney(order.totalAmount, order.currency)}
                </span>
                <OrderStatusBadge status={order.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
