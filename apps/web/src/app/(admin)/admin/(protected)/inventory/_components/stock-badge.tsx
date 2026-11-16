import type { StockStatus } from "@ecom/core";
import { Badge, type BadgeTone } from "@ecom/ui";

const LABEL: Record<StockStatus, string> = {
  untracked: "Not counted",
  in_stock: "In stock",
  low: "Low",
  out_of_stock: "Out of stock",
};

const TONE: Record<StockStatus, BadgeTone> = {
  untracked: "neutral",
  in_stock: "success",
  low: "warning",
  out_of_stock: "warning",
};

export function StockBadge({ status }: { status: StockStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
