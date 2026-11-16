import { formatAddress, formatMoney, type OrderView } from "@ecom/core";
import { Alert, Badge, type BadgeTone } from "@ecom/ui";
import { ButtonForm } from "./account-form";
import { retryPaymentAction } from "../checkout/actions";

const STATUS: Record<OrderView["status"], { label: string; tone: BadgeTone }> = {
  pending_payment: { label: "Waiting for payment", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  fulfilled: { label: "Sent", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export function OrderStatusBadge({ status }: { status: OrderView["status"] }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

/** One order as its shopper sees it: status, what to do next, items, totals, address. */
export function OrderDetails({ order, accessKey }: { order: OrderView; accessKey?: string }) {
  const money = (amount: number) => formatMoney(amount, order.currency);
  const lastPayment = order.payments[0];
  const payable = order.status === "pending_payment" && order.payBy > new Date();
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Order #{order.number}</h1>
        <span data-testid="order-status">
          <OrderStatusBadge status={order.status} />
        </span>
      </div>

      {order.status === "paid" || order.status === "fulfilled" ? (
        <Alert tone="success" testId="order-message">
          Thank you. We have received your payment and sent a confirmation to {order.email}.
        </Alert>
      ) : order.status === "pending_payment" ? (
        <div className="flex flex-col gap-3" data-testid="order-message">
          {lastPayment?.status === "failed" ? (
            <Alert tone="error" testId="payment-failed">
              The payment did not go through: {lastPayment.failureMessage} You can try again.
            </Alert>
          ) : lastPayment?.status === "pending" ? (
            <Alert tone="info">
              We are waiting for the payment to be confirmed. This page shows it as soon as it is.
            </Alert>
          ) : null}
          {payable ? (
            <>
              <p className="text-sm text-ink-muted">
                Your items are held until {when.format(order.payBy)}.
              </p>
              <ButtonForm
                action={retryPaymentAction}
                label="Pay now"
                tone="primary"
                fields={{ orderId: order.id, ...(accessKey ? { key: accessKey } : {}) }}
              />
            </>
          ) : null}
        </div>
      ) : order.status === "cancelled" ? (
        <Alert tone="info" testId="order-message">
          This order was cancelled and nothing was charged.
        </Alert>
      ) : null}

      <ul
        className="flex flex-col divide-y divide-line border-y border-line"
        data-testid="order-items"
      >
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{item.productName}</span>
              {item.color || item.size ? (
                <span className="text-ink-muted">
                  {" "}
                  · {[item.color, item.size].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              <span className="block text-ink-muted">
                {item.quantity} × {money(item.unitPriceAmount)}
              </span>
            </span>
            <span className="shrink-0 font-medium">{money(item.lineTotalAmount)}</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 sm:grid-cols-2">
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(order.subtotalAmount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd>{money(order.shippingAmount)}</dd>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd data-testid="order-total">{money(order.totalAmount)}</dd>
          </div>
          {lastPayment?.status === "succeeded" && lastPayment.methodLast4 ? (
            <div className="flex justify-between text-ink-muted">
              <dt>Paid with</dt>
              <dd>
                {lastPayment.methodBrand} ending {lastPayment.methodLast4}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="text-sm">
          <h2 className="font-medium">Delivering to</h2>
          <address className="mt-1 text-ink-muted not-italic">
            {formatAddress(order.shippingAddress).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <p className="mt-2 text-ink-muted">Placed {when.format(order.placedAt)}</p>
        </div>
      </div>
    </div>
  );
}
