"use server";

import {
  createCampaign,
  createLink,
  deleteCampaign,
  deleteLink,
  deleteSegment,
  ForbiddenError,
  MarketingError,
  NotFoundError,
  saveSegment,
  updateCampaign,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound, redirect } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../../actions";

// Campaigns, segments and tracking links (Milestone 7.1, decision D107). Each
// action needs marketing.write; the services check again inside the staff
// member's tenant and write the audit log. Nothing here spends money or
// posts anywhere.

const CAMPAIGNS = "/admin/marketing/campaigns";
const SEGMENTS = "/admin/marketing/segments";
const LINKS = "/admin/marketing/links";

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const all = (formData: FormData, name: string) =>
  formData.getAll(name).filter((v): v is string => typeof v === "string");

async function attempt(
  work: () => Promise<FormState>,
  values?: Record<string, string>,
): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MarketingError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const CAMPAIGN_FIELDS = [
  "name",
  "objective",
  "status",
  "startsOn",
  "endsOn",
  "audience",
  "keyMessage",
  "offer",
  "budget",
  "discountCodeId",
  "segmentId",
  "notes",
] as const;
const campaignValues = (formData: FormData) =>
  Object.fromEntries(CAMPAIGN_FIELDS.map((name) => [name, field(formData, name)])) as Record<
    (typeof CAMPAIGN_FIELDS)[number],
    string
  >;

export async function createCampaignAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  const values = campaignValues(formData);
  let id = "";
  const result = await attempt(async () => {
    const created = await createCampaign(tenantDb(context), context, {
      ...values,
      channels: all(formData, "channels"),
      productIds: all(formData, "productIds"),
    });
    id = created.id;
    return {};
  }, values);
  if (!id) return result;
  revalidatePath(CAMPAIGNS);
  redirect(`${CAMPAIGNS}/${id}`);
}

export async function updateCampaignAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  const id = field(formData, "id");
  const values = campaignValues(formData);
  return attempt(async () => {
    await updateCampaign(tenantDb(context), context, id, {
      ...values,
      channels: all(formData, "channels"),
      productIds: all(formData, "productIds"),
    });
    revalidatePath(CAMPAIGNS);
    revalidatePath(`${CAMPAIGNS}/${id}`);
    return { notice: "Campaign saved." };
  }, values);
}

export async function deleteCampaignAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  const result = await attempt(async () => {
    await deleteCampaign(tenantDb(context), context, field(formData, "id"));
    return { notice: "deleted" };
  });
  if (result.notice !== "deleted") return result;
  revalidatePath(CAMPAIGNS);
  redirect(CAMPAIGNS);
}

const SEGMENT_FIELDS = [
  "name",
  "minOrders",
  "minSpent",
  "orderedWithinDays",
  "noOrderForDays",
  "categoryId",
] as const;

export async function saveSegmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  const id = field(formData, "id") || null;
  const values = Object.fromEntries(SEGMENT_FIELDS.map((name) => [name, field(formData, name)]));
  let createdId = "";
  const result = await attempt(async () => {
    const saved = await saveSegment(tenantDb(context), context, id, {
      name: values.name,
      ...values,
    });
    if (!id) createdId = saved.id;
    revalidatePath(SEGMENTS);
    if (id) revalidatePath(`${SEGMENTS}/${id}`);
    return { notice: "Segment saved." };
  }, values);
  if (createdId) redirect(`${SEGMENTS}/${createdId}`);
  return result;
}

export async function deleteSegmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  const result = await attempt(async () => {
    await deleteSegment(tenantDb(context), context, field(formData, "id"));
    return { notice: "deleted" };
  });
  if (result.notice !== "deleted") return result;
  revalidatePath(SEGMENTS);
  redirect(SEGMENTS);
}

const LINK_FIELDS = [
  "label",
  "destination",
  "source",
  "medium",
  "campaignTag",
  "content",
  "campaignId",
  "postId",
] as const;

const revalidateLink = (campaignId: string, postId: string) => {
  revalidatePath(LINKS);
  if (campaignId) revalidatePath(`${CAMPAIGNS}/${campaignId}`);
  if (postId) revalidatePath(`/admin/marketing/posts/${postId}`);
};

export async function createLinkAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  const values = Object.fromEntries(
    LINK_FIELDS.map((name) => [name, field(formData, name)]),
  ) as Record<(typeof LINK_FIELDS)[number], string>;
  return attempt(async () => {
    await createLink(tenantDb(context), context, values);
    revalidateLink(values.campaignId, values.postId);
    return { notice: "Tracking link made. Share the short link." };
  }, values);
}

export async function deleteLinkAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("marketing.write");
  return attempt(async () => {
    await deleteLink(tenantDb(context), context, field(formData, "id"));
    revalidateLink(field(formData, "campaignId"), field(formData, "postId"));
    return { notice: "Link deleted. Its short address no longer works." };
  });
}
