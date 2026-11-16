import {
  formatAddress,
  formatMoney,
  getOrderForStaff,
  hasPermission,
  orderAmountLines,
  REFUND_METHOD_LABEL,
  REFUND_METHODS,
  RETURN_REASON_LABEL,
  RETURN_REASONS,
  type RefundMethod,
  type ReturnReason,
} from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, DangerForm, SelectField, TextField } from "../../../_components/form";
import {
  cancelOrderAction,
  cashCollectedAction,
  deliveryRefusedAction,
  fulfilOrderAction,
  recordReturnAction,
} from "../actions";
import { ORDER_LABEL, ORDER_TONE } from "../_components/order-status";

export const metadata: Metadata = { title: "Order" };

const EVENT_LABEL: Record<string, string> = {
  placed: "Order placed",
  paid: "Payment received",
  payment_failed: "Payment declined",
  payment_mismatch: "Payment notification did not match",
  paid_after_cancellation: "Paid after cancellation: refund needed",
  fulfilled: "Marked as sent",
  cash_collected: "Cash collected",
  delivery_refused: "Delivery refused, items back in stock",
  returned: "Return recorded",
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
  const cod = order.paymentMethod === "cash_on_delivery";
  const cashTaken = order.payments.some((payment) => payment.status === "succeeded");
  const paidAmount = order.payments
    .filter((payment) => payment.status === "succeeded")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const returned = new Map<string, number>();
  for (const recorded of order.returns) {
    for (const line of recorded.items) {
      returned.set(line.orderItemId, (returned.get(line.orderItemId) ?? 0) + line.quantity);
    }
  }
  const returnable = order.items.filter((item) => item.quantity > (returned.get(item.id) ?? 0));
  const canReturn =
    hasPermission(context, "returns.manage") &&
    (order.status === "fulfilled" || order.status === "refunded") &&
    paidAmount > 0 &&
    returnable.length > 0;
  const canRefund = hasPermission(context, "orders.refund") && paidAmount > order.refundedAmount;
  const itemName = new Map(order.items.map((item) => [item.id, item.productName]));

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
        <p className="text-sm text-ink-muted" data-testid="admin-payment-method">
          {cod ? "Cash on delivery" : "Paid online"}
          {cod && cashTaken ? ": cash collected" : ""}
        </p>
        {order.shipment ? (
          <p className="text-sm" data-testid="admin-shipment">
            Sent {when.format(order.shipment.shippedAt)}
            {order.shipment.courier ? ` with ${order.shipment.courier}` : ""}
            {order.shipment.trackingReference
              ? ` · tracking ${order.shipment.trackingReference}`
              : ""}
            {order.shipment.trackingUrl ? (
              <>
                {" · "}
                <a
                  href={order.shipment.trackingUrl}
                  className="underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Tracking link
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {canManage && (order.status === "paid" || order.status === "confirmed") ? (
          <ActionForm action={fulfilOrderAction} submitLabel="Mark as sent" testId="fulfil-form">
            <input type="hidden" name="id" value={order.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Courier" name="courier" maxLength={100} hint="Optional" />
              <TextField
                label="Tracking number"
                name="trackingReference"
                maxLength={100}
                hint="Optional"
              />
            </div>
            <TextField
              label="Tracking link"
              name="trackingUrl"
              type="url"
              maxLength={500}
              hint="Optional. A full https:// address; the shopper sees it on their order."
            />
            <TextField label="Note" name="note" maxLength={500} hint="Optional, for staff." />
          </ActionForm>
        ) : null}
        {canManage && cod && order.status === "fulfilled" && !cashTaken ? (
          <div className="flex flex-col gap-4">
            <ActionForm action={cashCollectedAction} submitLabel="Cash received" testId="cash-form">
              <input type="hidden" name="id" value={order.id} />
              <p className="text-sm text-ink-muted">
                When the courier has collected {money(order.totalAmount)}.
              </p>
            </ActionForm>
            <DangerForm
              action={deliveryRefusedAction}
              submitLabel="Delivery refused"
              confirmMessage={`Record that order #${order.number} came back unpaid? It is cancelled and its items go back into stock.`}
            >
              <input type="hidden" name="id" value={order.id} />
            </DangerForm>
          </div>
        ) : null}
        {canManage && (order.status === "pending_payment" || order.status === "confirmed") ? (
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
        <dl
          className="flex flex-col gap-1 border-t border-line pt-2 text-sm"
          data-testid="admin-order-amounts"
        >
          {orderAmountLines(order).map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="flex justify-between border-t border-line pt-2 font-semibold">
          <span>Total</span>
          <span>{money(order.totalAmount)}</span>
        </p>
        {order.refundedAmount > 0 ? (
          <p className="flex justify-between text-sm" data-testid="admin-refunded">
            <span>Given back</span>
            <span>{money(order.refundedAmount)}</span>
          </p>
        ) : null}
      </Card>

      {order.returns.length > 0 || canReturn ? (
        <Card title="Returns">
          {order.returns.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line text-sm" data-testid="admin-returns">
              {order.returns.map((recorded) => (
                <li key={recorded.id} className="flex flex-col gap-1 py-2">
                  <span className="font-medium">
                    {when.format(recorded.createdAt)} ·{" "}
                    {RETURN_REASON_LABEL[recorded.reason as ReturnReason] ?? recorded.reason}
                  </span>
                  <span>
                    {recorded.items
                      .map(
                        (line) =>
                          `${line.quantity} × ${itemName.get(line.orderItemId) ?? "Item"}${line.condition === "damaged" ? " (damaged)" : ""}`,
                      )
                      .join(", ")}
                  </span>
                  <span className="text-ink-muted">
                    {recorded.refundAmount > 0
                      ? `${money(recorded.refundAmount)} given back by ${(
                          REFUND_METHOD_LABEL[recorded.refundMethod as RefundMethod] ?? "other"
                        ).toLowerCase()}`
                      : "No money given back"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {canReturn ? (
            <details className="rounded-control border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">Record a return</summary>
              <div className="mt-3">
                <ActionForm
                  action={recordReturnAction}
                  submitLabel="Record return"
                  testId="return-form"
                >
                  <input type="hidden" name="id" value={order.id} />
                  <p className="text-sm text-ink-muted">
                    Enter how many of each item came back. Resellable items go back on sale; damaged
                    ones are kept apart.
                  </p>
                  {returnable.map((item) => {
                    const left = item.quantity - (returned.get(item.id) ?? 0);
                    return (
                      <div
                        key={item.id}
                        className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem] sm:items-end"
                      >
                        <p className="text-sm">
                          <span className="font-medium">{item.productName}</span>{" "}
                          <span className="text-ink-muted">
                            ({item.sku}) · up to {left}
                          </span>
                        </p>
                        <TextField
                          id={`qty-${item.id}`}
                          label={`How many: ${item.productName}`}
                          name={`qty-${item.id}`}
                          inputMode="numeric"
                          defaultValue=""
                        />
                        <SelectField
                          id={`condition-${item.id}`}
                          label={`Condition: ${item.productName}`}
                          name={`condition-${item.id}`}
                          defaultValue="resellable"
                          options={[
                            { value: "resellable", label: "Can be sold again" },
                            { value: "damaged", label: "Damaged" },
                          ]}
                        />
                      </div>
                    );
                  })}
                  <SelectField
                    label="Reason"
                    name="reason"
                    defaultValue=""
                    options={[
                      { value: "", label: "Choose a reason" },
                      ...RETURN_REASONS.map((value) => ({
                        value,
                        label: RETURN_REASON_LABEL[value],
                      })),
                    ]}
                  />
                  <TextField label="Note" name="note" maxLength={500} hint="Optional, for staff." />
                  {canRefund ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label={`Money given back (${order.currency})`}
                        name="refund"
                        inputMode="decimal"
                        hint={`Optional. Up to ${money(paidAmount - order.refundedAmount)}. Card refunds through the payment provider are not built yet.`}
                      />
                      <SelectField
                        label="Given back by"
                        name="refundMethod"
                        defaultValue=""
                        options={[
                          { value: "", label: "Choose" },
                          ...REFUND_METHODS.map((value) => ({
                            value,
                            label: REFUND_METHOD_LABEL[value],
                          })),
                        ]}
                      />
                    </div>
                  ) : null}
                </ActionForm>
              </div>
            </details>
          ) : null}
        </Card>
      ) : null}

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
