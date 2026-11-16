"use server";

import {
  ForbiddenError,
  moderateReview,
  NotFoundError,
  replyToReview,
  ReviewError,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Review moderation. Every action checks reviews.moderate itself; the
// services check it again, run inside the staff member's tenant and write
// the audit log. Staff never change what a customer wrote.

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function attempt(
  work: () => Promise<FormState>,
  values?: Record<string, string>,
): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReviewError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const NOTICE: Record<string, string> = {
  approved: "Approved: it is now shown on the product page.",
  rejected: "Rejected: it will not be shown.",
  hidden: "Hidden from the product page.",
};

export async function moderateReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("reviews.moderate");
  const status = field(formData, "status");
  return attempt(async () => {
    await moderateReview(tenantDb(context), context, field(formData, "id"), status);
    revalidatePath("/admin/reviews");
    revalidatePath("/p/[slug]", "page");
    return { notice: NOTICE[status] ?? "Saved." };
  });
}

export async function replyToReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("reviews.moderate");
  const values = { reply: field(formData, "reply") };
  return attempt(async () => {
    await replyToReview(tenantDb(context), context, field(formData, "id"), values.reply);
    revalidatePath("/admin/reviews");
    revalidatePath("/p/[slug]", "page");
    return { notice: values.reply.trim() ? "Reply saved." : "Reply removed." };
  }, values);
}
