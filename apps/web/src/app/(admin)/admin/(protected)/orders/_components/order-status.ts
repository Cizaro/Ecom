import type { OrderStatusValue } from "@ecom/core";
import type { BadgeTone } from "@ecom/ui";

export const ORDER_LABEL: Record<OrderStatusValue, string> = {
  pending_payment: "Waiting for payment",
  confirmed: "Confirmed, cash on delivery",
  paid: "Paid",
  fulfilled: "Sent",
  cancelled: "Cancelled",
  refunded: "Refunded",
};
export const ORDER_TONE: Record<OrderStatusValue, BadgeTone> = {
  pending_payment: "warning",
  confirmed: "success",
  paid: "success",
  fulfilled: "neutral",
  cancelled: "neutral",
  refunded: "neutral",
};
