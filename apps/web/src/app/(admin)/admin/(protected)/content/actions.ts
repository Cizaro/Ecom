"use server";

import {
  addStaffUgc,
  ForbiddenError,
  MAX_VIDEO_BYTES,
  moderateUgc,
  NotFoundError,
  removeUgc,
  UgcError,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import { mediaDeps } from "@/server/media";
import type { FormState } from "../../actions";

// Customer and creator photos. Moderating needs reviews.moderate; adding a
// creator's content needs content.write. The services check again, run
// inside the staff member's tenant and write the audit log.

const PAGE = "/admin/content";

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
    if (error instanceof UgcError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const refresh = () => {
  revalidatePath(PAGE);
  revalidatePath("/gallery");
  revalidatePath("/p/[slug]", "page");
  revalidatePath("/", "layout");
};

const NOTICE: Record<string, string> = {
  approved: "Approved: it is now shown.",
  rejected: "Rejected: it will not be shown.",
  hidden: "Hidden from the shop.",
  feature: "Featured at the top of the gallery.",
  unfeature: "No longer featured.",
};

export async function moderateUgcAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("reviews.moderate");
  const action = field(formData, "action");
  return attempt(async () => {
    await moderateUgc(tenantDb(context), context, field(formData, "id"), action);
    refresh();
    return { notice: NOTICE[action] ?? "Saved." };
  });
}

export async function removeUgcAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("reviews.moderate");
  return attempt(async () => {
    await removeUgc(tenantDb(context), context, mediaDeps(), field(formData, "id"));
    refresh();
    return { notice: "Removed and the file deleted." };
  });
}

export async function addStaffUgcAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("content.write");
  const values = {
    productId: field(formData, "productId"),
    caption: field(formData, "caption"),
    creditName: field(formData, "creditName"),
    sourceUrl: field(formData, "sourceUrl"),
    permissionNote: field(formData, "permissionNote"),
  };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo or video.", values };
  }
  if (file.size > MAX_VIDEO_BYTES)
    return { error: "The file is too large (8 MB at most).", values };
  return attempt(async () => {
    await addStaffUgc(tenantDb(context), context, mediaDeps(), {
      ...values,
      bytes: new Uint8Array(await file.arrayBuffer()),
      confirmed: formData.get("confirmed") === "on",
    });
    refresh();
    return { notice: "Added." };
  }, values);
}
