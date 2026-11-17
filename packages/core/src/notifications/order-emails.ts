import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from "@ecom/i18n";
import { formatMoney } from "../catalog/money";
import { formatAddress } from "../customers/addresses";
import { orderAmountLines, type OrderView } from "../orders/orders";
import type { EmailMessage } from "./email";

// The wording of every store email, in one place. Plain text: it reads well
// everywhere and carries no tracking. Emails state only what the order
// records; they never promise a delivery date or invent stock. Emails to
// shoppers are written in the language they used the shop in (the English
// here is the key for the Arabic in @ecom/i18n); emails to staff are in
// English.

export interface StoreLinks {
  name: string;
  url: string;
}

/** A header must stay on one line, whatever a store or product is called. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const footer = (store: StoreLinks) => ["", oneLine(store.name), store.url];

function itemLines(order: OrderView, t: Translator): string[] {
  return order.items.map((item) => {
    const options = [item.color, item.size].filter(Boolean).join(", ");
    return `${item.quantity} x ${oneLine(item.productName)}${options ? ` (${options})` : ""}: ${t.money(item.lineTotalAmount, order.currency)}`;
  });
}

function summary(order: OrderView, t: Translator): string[] {
  return [
    t("Order #{number}", { number: order.number }),
    ...itemLines(order, t),
    ...orderAmountLines(order, t).map(([label, value]) => `${label}: ${value}`),
    `${t("Total")}: ${t.money(order.totalAmount, order.currency)}`,
  ];
}

const cod = (order: OrderView) => order.paymentMethod === "cash_on_delivery";
const cashPaid = (order: OrderView) => order.payments.some((p) => p.status === "succeeded");
const shopperT = (order: OrderView) => createTranslator(order.locale ?? DEFAULT_LOCALE);

/** Sent when an order is placed for cash on delivery, or paid online. */
export function orderConfirmationEmail(
  order: OrderView,
  store: StoreLinks,
  orderUrl: string,
): EmailMessage {
  const t = shopperT(order);
  const money = (amount: number) => t.money(amount, order.currency);
  return {
    to: order.email,
    subject: oneLine(
      t("Order #{number} confirmed: {store}", { number: order.number, store: store.name }),
    ),
    text: [
      cod(order)
        ? t("Thank you for your order. You pay in cash when it arrives.")
        : t("Thank you for your order. We have received your payment."),
      "",
      ...summary(order, t),
      "",
      cod(order)
        ? t("To pay the courier in cash: {amount}", { amount: money(order.totalAmount) })
        : t("Total paid: {amount}", { amount: money(order.totalAmount) }),
      "",
      t("Delivering to:"),
      ...formatAddress(order.shippingAddress, t.intl),
      "",
      t("See your order: {url}", { url: orderUrl }),
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
  const t = shopperT(order);
  const shipment = order.shipment;
  const tracking = [
    shipment?.courier ? t("Courier: {courier}", { courier: oneLine(shipment.courier) }) : null,
    shipment?.trackingReference
      ? t("Tracking number: {reference}", { reference: oneLine(shipment.trackingReference) })
      : null,
    shipment?.trackingUrl ? t("Track your parcel: {url}", { url: shipment.trackingUrl }) : null,
  ].filter((line): line is string => line !== null);
  return {
    to: order.email,
    subject: oneLine(
      t("Order #{number} is on its way: {store}", { number: order.number, store: store.name }),
    ),
    text: [
      t("Good news: your order has been sent."),
      ...(tracking.length > 0 ? ["", ...tracking] : []),
      ...(cod(order) && !cashPaid(order)
        ? [
            "",
            t("Please have {amount} in cash ready for the courier.", {
              amount: t.money(order.totalAmount, order.currency),
            }),
          ]
        : []),
      "",
      ...summary(order, t),
      "",
      t("Delivering to:"),
      ...formatAddress(order.shippingAddress, t.intl),
      "",
      t("See your order: {url}", { url: orderUrl }),
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
  const t = shopperT(order);
  return {
    to: order.email,
    subject: oneLine(
      t("Payment received for order #{number}: {store}", {
        number: order.number,
        store: store.name,
      }),
    ),
    text: [
      t("We have received your payment of {amount}. Thank you for shopping with us.", {
        amount: t.money(order.totalAmount, order.currency),
      }),
      "",
      ...summary(order, t),
      "",
      t("See your order: {url}", { url: orderUrl }),
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
  const t = shopperT(order);
  return {
    to: order.email,
    subject: oneLine(
      t("Order #{number} cancelled: {store}", { number: order.number, store: store.name }),
    ),
    text: [
      reason === "expired"
        ? t("Your order was cancelled because the payment was not completed in time.")
        : t("The store has cancelled your order."),
      t("Nothing was charged. If you still want these items, you are welcome to order again."),
      "",
      ...summary(order, t),
      "",
      t("See your order: {url}", { url: orderUrl }),
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
  const t = shopperT(order);
  const recorded = order.returns.find((r) => r.id === returnId);
  const names = new Map(order.items.map((item) => [item.id, item]));
  const lines = (recorded?.items ?? []).map((line) => {
    const item = names.get(line.orderItemId);
    return `${line.quantity} x ${oneLine(item?.productName ?? t("Item"))}`;
  });
  const refund = recorded?.refundAmount ?? 0;
  return {
    to: order.email,
    subject: oneLine(
      t("Return recorded for order #{number}: {store}", {
        number: order.number,
        store: store.name,
      }),
    ),
    text: [
      t("We have received the items you sent back:"),
      ...lines,
      "",
      refund > 0
        ? t("We have given back {amount}.", { amount: t.money(refund, order.currency) })
        : t("No money has been given back for this return."),
      "",
      t("See your order: {url}", { url: orderUrl }),
      ...footer(store),
    ].join("\n"),
  };
}

const staffT = createTranslator(DEFAULT_LOCALE);

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
      ...summary(order, staffT),
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
  /** The shop language the shopper wrote in; emails to them use it. */
  locale?: Locale;
}

/** Sent to the shopper when they start a conversation: proof it arrived, and their link. */
export function supportReceivedEmail(
  conversation: SupportEmailData,
  store: StoreLinks,
  link: string,
): EmailMessage {
  const t = createTranslator(conversation.locale ?? DEFAULT_LOCALE);
  return {
    to: conversation.email,
    subject: oneLine(t("We received your message: {subject}", { subject: conversation.subject })),
    text: [
      t("Hello {name},", { name: oneLine(conversation.name) }),
      "",
      t("Thank you for writing to {store}. We will reply as soon as we can.", {
        store: oneLine(store.name),
      }),
      "",
      t("Your message:"),
      conversation.message.body,
      "",
      t("See the conversation and reply: {url}", { url: link }),
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
  const t = createTranslator(conversation.locale ?? DEFAULT_LOCALE);
  return {
    to: conversation.email,
    subject: oneLine(`Re: ${conversation.subject}`),
    text: [
      t("{name} from {store} replied:", {
        name: oneLine(conversation.message.authorName),
        store: oneLine(store.name),
      }),
      "",
      conversation.message.body,
      "",
      t("Reply or see the whole conversation: {url}", { url: link }),
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
