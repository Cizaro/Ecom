import type { MessageCategory } from "@ecom/ai";

/** How the AI's message categories read for staff. */
export const CATEGORY_LABEL: Record<MessageCategory, string> = {
  question: "Question",
  order_status: "Order status",
  other: "Other",
  refund: "Refund",
  payment_problem: "Payment problem",
  legal: "Legal",
  threat: "Threat",
  privacy: "Privacy request",
  complaint: "Complaint",
  account: "Account",
  spam: "Spam",
  abuse: "Abuse",
};
