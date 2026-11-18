import type { ResearchKind } from "@ecom/core";

export const KIND_LABEL: Record<ResearchKind, string> = {
  product: "Product",
  price: "Price",
  promotion: "Promotion",
  post: "Post",
  hook: "Hook or angle",
  hashtag: "Hashtag",
  review: "Customer review",
  other: "Other",
};
