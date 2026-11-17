import { msg } from "@ecom/i18n";
import { formatAddress, orderAmountLines, type OrderView } from "@ecom/core";
import { Alert, Badge, type BadgeTone } from "@ecom/ui";
import { ButtonForm } from "./account-form";
import { retryPaymentAction } from "../checkout/actions";
import { shopT } from "@/server/i18n";

const STATUS: Record<OrderView["status"], { label: string; tone: BadgeTone }> = {
  pending_payment: { label: msg("Waiting for payment"), tone: "warning" },
  confirmed: { label: msg("Confirmed"), tone: "success" },
  paid: { label: msg("Paid"), tone: "success" },
  fulfilled: { label: msg("Sent"), tone: "success" },
  cancelled: { label: msg("Cancelled"), tone: "neutral" },
  refunded: { label: msg("Refunded"), tone: "neutral" },
};

export async function OrderStatusBadge({ status }: { status: OrderView["status"] }) {
  const t = await shopT();
  return <Badge tone={STATUS[status].tone}>{t(STATUS[status].label)}</Badge>;
}

/** One order as its shopper sees it: status, what to do next, items, totals, address. */
export async function OrderDetails({ order, accessKey }: { order: OrderView; accessKey?: string }) {
  const t = await shopT();
  const money = (amount: number) => t.money(amount, order.currency);
  const lastPayment = order.payments[0];
  const cod = order.paymentMethod === "cash_on_delivery";
  const paid = order.payments.some((payment) => payment.status === "succeeded");
  const payable = order.status === "pending_payment" && order.payBy > new Date();
  const when = new Intl.DateTimeFormat(t.intl, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("Order #{number}", { number: order.number })}
        </h1>
        <span data-testid="order-status">
          <OrderStatusBadge status={order.status} />
        </span>
      </div>

      {cod && (order.status === "confirmed" || (order.status === "fulfilled" && !paid)) ? (
        <Alert tone="success" testId="order-message">
          {order.status === "confirmed"
            ? t("Thank you. Your order is confirmed and we have sent a confirmation to {email}.", {
                email: order.email,
              })
            : t("Your order is on its way. We sent the confirmation to {email}.", {
                email: order.email,
              })}{" "}
          {t("Pay {amount} in cash to the courier when it arrives.", {
            amount: money(order.totalAmount),
          })}
        </Alert>
      ) : order.status === "paid" || order.status === "fulfilled" ? (
        <Alert tone="success" testId="order-message">
          {cod
            ? t("Thank you. Your order was delivered and paid.")
            : t("Thank you. We have received your payment and sent a confirmation to {email}.", {
                email: order.email,
              })}
        </Alert>
      ) : order.status === "pending_payment" ? (
        <div className="flex flex-col gap-3" data-testid="order-message">
          {lastPayment?.status === "failed" ? (
            <Alert tone="error" testId="payment-failed">
              {t("The payment did not go through: {reason} You can try again.", {
                reason: t.message(lastPayment.failureMessage ?? ""),
              })}
            </Alert>
          ) : lastPayment?.status === "pending" ? (
            <Alert tone="info">
              {t(
                "We are waiting for the payment to be confirmed. This page shows it as soon as it is.",
              )}
            </Alert>
          ) : null}
          {payable ? (
            <>
              <p className="text-sm text-ink-muted">
                {t("Your items are held until {time}.", { time: when.format(order.payBy) })}
              </p>
              <ButtonForm
                action={retryPaymentAction}
                label={t("Pay now")}
                tone="primary"
                fields={{ orderId: order.id, ...(accessKey ? { key: accessKey } : {}) }}
              />
            </>
          ) : null}
        </div>
      ) : order.status === "cancelled" ? (
        <Alert tone="info" testId="order-message">
          {paid
            ? t("This order was cancelled.")
            : t("This order was cancelled and nothing was charged.")}
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

      {order.returns.length > 0 ? (
        <section aria-labelledby="order-returns" className="text-sm" data-testid="order-returns">
          <h2 id="order-returns" className="font-medium">
            {t("Returns")}
          </h2>
          <ul className="mt-1 flex flex-col gap-1 text-ink-muted">
            {order.returns.map((recorded) => (
              <li key={recorded.id}>
                {when.format(recorded.createdAt)}:{" "}
                {t("{items} received.", {
                  items: recorded.items
                    .map(
                      (line) =>
                        `${line.quantity} × ${order.items.find((item) => item.id === line.orderItemId)?.productName ?? t("Item")}`,
                    )
                    .join(", "),
                })}
                {recorded.refundAmount > 0
                  ? ` ${t("{amount} given back.", { amount: money(recorded.refundAmount) })}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <dl className="flex flex-col gap-1 text-sm">
          {orderAmountLines(order, t).map(([label, value]) => (
            <div key={label} className="flex justify-between" data-testid="order-amount">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className="flex justify-between text-base font-semibold">
            <dt>{t("Total")}</dt>
            <dd data-testid="order-total">{money(order.totalAmount)}</dd>
          </div>
          {order.refundedAmount > 0 ? (
            <div className="flex justify-between" data-testid="order-refunded">
              <dt>{t("Given back")}</dt>
              <dd>{money(order.refundedAmount)}</dd>
            </div>
          ) : null}
          {cod ? (
            <div className="flex justify-between text-ink-muted">
              <dt>{t("Payment")}</dt>
              <dd data-testid="payment-method">
                {paid ? t("Paid in cash on delivery") : t("Cash on delivery")}
              </dd>
            </div>
          ) : null}
          {lastPayment?.status === "succeeded" && lastPayment.methodLast4 ? (
            <div className="flex justify-between text-ink-muted">
              <dt>{t("Paid with")}</dt>
              <dd>
                {t("{brand} ending {last4}", {
                  brand: lastPayment.methodBrand ?? "",
                  last4: lastPayment.methodLast4,
                })}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="text-sm">
          <h2 className="font-medium">{t("Delivering to")}</h2>
          <address className="mt-1 text-ink-muted not-italic">
            {formatAddress(order.shippingAddress, t.intl).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <p className="mt-2 text-ink-muted">
            {t("Placed {time}", { time: when.format(order.placedAt) })}
          </p>
          {order.shipment ? (
            <p className="mt-2" data-testid="order-shipment">
              {order.shipment.courier
                ? t("Sent {time} with {courier}.", {
                    time: when.format(order.shipment.shippedAt),
                    courier: order.shipment.courier,
                  })
                : t("Sent {time}.", { time: when.format(order.shipment.shippedAt) })}
              {order.shipment.trackingReference
                ? ` ${t("Tracking number: {reference}", { reference: order.shipment.trackingReference })}`
                : ""}
              {order.shipment.trackingUrl ? (
                <>
                  {" "}
                  <a
                    href={order.shipment.trackingUrl}
                    className="underline underline-offset-4"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {t("Track your parcel")}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
