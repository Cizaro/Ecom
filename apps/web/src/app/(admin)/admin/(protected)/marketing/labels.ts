import type { PostChannel, PostFormat, PostStatus } from "@ecom/core";

/** How content words read for staff. */
export const CHANNEL_LABEL: Record<PostChannel, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  other: "Other",
};

export const FORMAT_LABEL: Record<PostFormat, string> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
  carousel: "Carousel",
};

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  in_review: "Waiting for approval",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
};

export const STATUS_TONE: Record<PostStatus, "neutral" | "warning" | "success"> = {
  draft: "neutral",
  in_review: "warning",
  changes_requested: "warning",
  approved: "success",
  published: "success",
};
