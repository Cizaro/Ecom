import { formatMoney } from "../catalog/money";
import { formatAddress } from "../customers/addresses";
import { orderAmountLines, type OrderView } from "../orders/orders";
import type { EmailMessage } from "./email";

// The wording of every store email, in one place. Plain text: it reads well
// everywhere and carries no tracking. Emails state only what the order
// records; they never promise a delivery date or invent stock.

export interface StoreLinks {
  name: string;
  url: string;
}

/** A header must stay on one line, whatever a store or product is called. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const footer = (store: StoreLinks) => ["", oneLine(store.name), store.url];

function itemLines(order: OrderView): string[] {
  const money = (amount: number) => formatMoney(amount, order.currency);
  return order.items.map((item) => {
    const options = [item.color, item.size].filter(Boolean).join(", ");
    return `${item.quantity} x ${oneLine(item.productName)}${options ? ` (${options})` : ""}: ${money(item.lineTotalAmount)}`;
  });
}

function summary(order: OrderView): string[] {
  return [
    `Order #${order.number}`,
    ...itemLines(order),
    ...orderAmountLines(order).map(([label, value]) => `${label}: ${value}`),
    `Total: ${formatMoney(order.totalAmount, order.currency)}`,
  ];
}

const cod = (order: OrderView) => order.paymentMethod === "cash_on_delivery";
const cashPaid = (order: OrderView) => order.payments.some((p) => p.status === "succeeded");

/** Sent when an order is placed for cash on delivery, or paid online. */
export function orderConfirmationEmail(
  order: OrderView,
  store: StoreLinks,
  orderUrl: string,
): EmailMessage {
  const money = (amount: number) => formatMoney(amount, order.currency);
  return {
    to: order.email,
    subject: oneLine(`Order #${order.number} confirmed: ${store.name}`),
    text: [
      cod(order)
        ? "Thank you for your order. You pay in cash when it arrives."
        : "Thank you for your order. We have received your payment.",
      "",
      ...summary(order),
      "",
      cod(order)
        ? `To pay the courier in cash: ${money(order.totalAmount)}`
        : `Total paid: ${money(order.totalAmount)}`,
      "",
      "Delivering to:",
      ...formatAddress(order.shippingAddress),
      "",
      `See your order: ${orderUrl}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent when staff mark the order as sent. */
export function orderShippedEmail(
  order: OrderView,
  store: StoreLinks,
  orderUrl: string,
): EmailMessage {
  const shipment = order.shipment;
  const tracking = [
    shipment?.courier ? `Courier: ${oneLine(shipment.courier)}` : null,
    shipment?.trackingReference ? `Tracking number: ${oneLine(shipment.trackingReference)}` : null,
    shipment?.trackingUrl ? `Track your parcel: ${shipment.trackingUrl}` : null,
  ].filter((line): line is string => line !== null);
  return {
    to: order.email,
    subject: oneLine(`Order #${order.number} is on its way: ${store.name}`),
    text: [
      "Good news: your order has been sent.",
      ...(tracking.length > 0 ? ["", ...tracking] : []),
      ...(cod(order) && !cashPaid(order)
        ? [
            "",
            `Please have ${formatMoney(order.totalAmount, order.currency)} in cash ready for the courier.`,
          ]
        : []),
      "",
      ...summary(order),
      "",
      "Delivering to:",
      ...formatAddress(order.shippingAddress),
      "",
      `See your order: ${orderUrl}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent when staff record the cash collected for a cash-on-delivery order. */
export function paymentReceivedEmail(
  order: OrderView,
  store: StoreLinks,
  orderUrl: string,
): EmailMessage {
  return {
    to: order.email,
    subject: oneLine(`Payment received for order #${order.number}: ${store.name}`),
    text: [
      `We have received your payment of ${formatMoney(order.totalAmount, order.currency)}. Thank you for shopping with us.`,
      "",
      ...summary(order),
      "",
      `See your order: ${orderUrl}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent when an order that was not paid or sent is cancelled. */
export function orderCancelledEmail(
  order: OrderView,
  store: StoreLinks,
  orderUrl: string,
  reason: "expired" | "staff",
): EmailMessage {
  return {
    to: order.email,
    subject: oneLine(`Order #${order.number} cancelled: ${store.name}`),
    text: [
      reason === "expired"
        ? "Your order was cancelled because the payment was not completed in time."
        : "The store has cancelled your order.",
      "Nothing was charged. If you still want these items, you are welcome to order again.",
      "",
      ...summary(order),
      "",
      `See your order: ${orderUrl}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent when staff record items the customer gave back (and any money refunded). */
export function returnRecordedEmail(
  order: OrderView,
  store: StoreLinks,
  orderUrl: string,
  returnId: string,
): EmailMessage {
  const recorded = order.returns.find((r) => r.id === returnId);
  const names = new Map(order.items.map((item) => [item.id, item]));
  const lines = (recorded?.items ?? []).map((line) => {
    const item = names.get(line.orderItemId);
    return `${line.quantity} x ${oneLine(item?.productName ?? "Item")}`;
  });
  const refund = recorded?.refundAmount ?? 0;
  return {
    to: order.email,
    subject: oneLine(`Return recorded for order #${order.number}: ${store.name}`),
    text: [
      "We have received the items you sent back:",
      ...lines,
      "",
      refund > 0
        ? `We have given back ${formatMoney(refund, order.currency)}.`
        : "No money has been given back for this return.",
      "",
      `See your order: ${orderUrl}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent to the store's order addresses when an order is ready to prepare. */
export function staffNewOrderEmail(
  order: OrderView,
  store: StoreLinks,
  adminUrl: string,
  to: string,
): EmailMessage {
  const address = order.shippingAddress;
  return {
    to,
    subject: oneLine(
      `New order #${order.number}: ${formatMoney(order.totalAmount, order.currency)}, ${
        cod(order) ? "cash on delivery" : "paid online"
      }`,
    ),
    text: [
      `A new order is ready to prepare in ${oneLine(store.name)}.`,
      "",
      ...summary(order),
      "",
      cod(order)
        ? `Cash on delivery: the courier collects ${formatMoney(order.totalAmount, order.currency)}.`
        : "Paid online.",
      ...(order.shippingZoneName ? [`Delivery area: ${oneLine(order.shippingZoneName)}`] : []),
      `Customer email: ${order.email}`,
      ...(address.phone ? [`Phone: ${address.phone}`] : []),
      "",
      "Delivering to:",
      ...formatAddress(address),
      "",
      `Open the order: ${adminUrl}`,
    ].join("\n"),
  };
}

export interface LowStockItem {
  variantId: string;
  productName: string;
  sku: string;
  color: string | null;
  size: string | null;
  available: number;
}

/** Sent to the store's stock addresses when a product drops to its low-stock level. */
export function staffLowStockEmail(
  item: LowStockItem,
  store: StoreLinks,
  adminUrl: string,
  to: string,
): EmailMessage {
  const options = [item.color, item.size].filter(Boolean).join(", ");
  const name = `${oneLine(item.productName)}${options ? ` (${options})` : ""}`;
  return {
    to,
    subject: oneLine(
      item.available <= 0 ? `Sold out: ${name}, ${item.sku}` : `Low stock: ${name}, ${item.sku}`,
    ),
    text: [
      item.available <= 0
        ? `${name} (SKU ${item.sku}) has none left to sell in ${oneLine(store.name)}.`
        : `${name} (SKU ${item.sku}) has ${item.available} left to sell in ${oneLine(store.name)}.`,
      "Items held for checkouts in progress are not counted as left to sell.",
      "",
      `See its stock: ${adminUrl}`,
    ].join("\n"),
  };
}

// --- Support conversations -----------------------------------------------------

export interface SupportEmailData {
  subject: string;
  name: string;
  email: string;
  /** The message the email is about. */
  message: { authorName: string; body: string };
}

/** Sent to the shopper when they start a conversation: proof it arrived, and their link. */
export function supportReceivedEmail(
  conversation: SupportEmailData,
  store: StoreLinks,
  link: string,
): EmailMessage {
  return {
    to: conversation.email,
    subject: oneLine(`We received your message: ${conversation.subject}`),
    text: [
      `Hello ${oneLine(conversation.name)},`,
      "",
      `Thank you for writing to ${oneLine(store.name)}. We will reply as soon as we can.`,
      "",
      "Your message:",
      conversation.message.body,
      "",
      `See the conversation and reply: ${link}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent to the shopper when staff reply. */
export function supportReplyEmail(
  conversation: SupportEmailData,
  store: StoreLinks,
  link: string,
): EmailMessage {
  return {
    to: conversation.email,
    subject: oneLine(`Re: ${conversation.subject}`),
    text: [
      `${oneLine(conversation.message.authorName)} from ${oneLine(store.name)} replied:`,
      "",
      conversation.message.body,
      "",
      `Reply or see the whole conversation: ${link}`,
      ...footer(store),
    ].join("\n"),
  };
}

/** Sent to the store's support addresses for each message from a shopper. */
export function staffSupportMessageEmail(
  conversation: SupportEmailData,
  store: StoreLinks,
  adminUrl: string,
  to: string,
): EmailMessage {
  return {
    to,
    subject: oneLine(`New message: ${conversation.subject}`),
    text: [
      `${oneLine(conversation.name)} (${conversation.email}) wrote to ${oneLine(store.name)}:`,
      "",
      conversation.message.body,
      "",
      `Answer it: ${adminUrl}`,
    ].join("\n"),
  };
}
