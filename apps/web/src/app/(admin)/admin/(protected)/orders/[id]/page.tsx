import { formatAddress, formatMoney, getOrderForStaff, hasPermission } from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, DangerForm, TextField } from "../../../_components/form";
import { cancelOrderAction, fulfilOrderAction } from "../actions";
import { ORDER_LABEL, ORDER_TONE } from "../_components/order-status";

export const metadata: Metadata = { title: "Order" };

const EVENT_LABEL: Record<string, string> = {
  placed: "Order placed",
  paid: "Payment received",
  payment_failed: "Payment declined",
  payment_mismatch: "Payment notification did not match",
  paid_after_cancellation: "Paid after cancellation: refund needed",
  fulfilled: "Marked as sent",
  cancelled: "Cancelled",
};
const ACTOR_LABEL: Record<string, string> = {
  guest: "Guest",
  customer: "Customer",
  staff: "Staff",
  payment_provider: "Payment provider",
  system: "Automatic",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("orders.read");
  const { id } = await params;
  const order = await orNotFound(getOrderForStaff(tenantDb(context), context, id));
  const canManage = hasPermission(context, "orders.manage");
  const money = (amount: number) => formatMoney(amount, order.currency);
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  const needsRefund = order.events.some((event) => event.type === "paid_after_cancellation");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Order #${order.number}`}
        description={
          <>
            {order.email} · placed {when.format(order.placedAt)} ·{" "}
            <Link href="/admin/orders" className="underline underline-offset-4">
              All orders
            </Link>
          </>
        }
      />
      {needsRefund ? (
        <Alert tone="error" testId="needs-refund">
          A payment arrived after this order was cancelled. Refund it with the payment provider.
        </Alert>
      ) : null}

      <Card title="Status">
        <span data-testid="admin-order-status">
          <Badge tone={ORDER_TONE[order.status]}>{ORDER_LABEL[order.status]}</Badge>
        </span>
        {canManage && order.status === "paid" ? (
          <ActionForm action={fulfilOrderAction} submitLabel="Mark as sent" testId="fulfil-form">
            <input type="hidden" name="id" value={order.id} />
            <TextField
              label="Note"
              name="note"
              maxLength={500}
              hint="Optional, for example the courier."
            />
          </ActionForm>
        ) : null}
        {canManage && order.status === "pending_payment" ? (
          <DangerForm
            action={cancelOrderAction}
            submitLabel="Cancel order"
            confirmMessage={`Cancel order #${order.number}? Its items go back into stock.`}
          >
            <input type="hidden" name="id" value={order.id} />
          </DangerForm>
        ) : null}
      </Card>

      <Card title="Items">
        <ul className="flex flex-col divide-y divide-line text-sm" data-testid="admin-order-items">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-2">
              <span>
                {item.quantity} × {item.productName}{" "}
                <span className="text-ink-muted">
                  ({[item.sku, item.color, item.size].filter(Boolean).join(" · ")})
                </span>
              </span>
              <span className="shrink-0">{money(item.lineTotalAmount)}</span>
            </li>
          ))}
        </ul>
        <p className="flex justify-between border-t border-line pt-2 font-semibold">
          <span>Total</span>
          <span>{money(order.totalAmount)}</span>
        </p>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="Delivery address">
          <address className="text-sm not-italic">
            {formatAddress(order.shippingAddress).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </Card>
        <Card title="Payments">
          {order.payments.length === 0 ? (
            <p className="text-sm text-ink-muted">No payment started.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {order.payments.map((payment) => (
                <li key={payment.id}>
                  <span className="font-medium">{payment.status}</span> · {money(payment.amount)}
                  {payment.methodLast4
                    ? ` · ${payment.methodBrand} ending ${payment.methodLast4}`
                    : ""}
                  {payment.failureMessage ? (
                    <span className="block text-ink-muted">{payment.failureMessage}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="History">
        <ol className="flex flex-col divide-y divide-line text-sm" data-testid="order-history">
          {order.events.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{EVENT_LABEL[event.type] ?? event.type}</span>
                {event.note ? <span className="text-ink-muted"> · {event.note}</span> : null}
              </span>
              <span className="text-ink-muted">
                {ACTOR_LABEL[event.actorType] ?? event.actorType} · {when.format(event.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
