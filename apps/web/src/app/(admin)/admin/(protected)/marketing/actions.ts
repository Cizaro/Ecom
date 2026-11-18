"use server";

import {
  addLibraryFile,
  ContentError,
  createPost,
  deletePost,
  draftPostCaption,
  ForbiddenError,
  hasPermission,
  movePost,
  NotFoundError,
  updateLibraryFile,
  updatePost,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound, redirect } from "next/navigation";
import { aiGateway } from "@/server/ai";
import { requirePermission, tenantDb } from "@/server/access";
import { mediaDeps } from "@/server/media";
import type { FormState } from "../../actions";

// Content library, posts and their approval. Every action checks its own
// permission; the services check again inside the staff member's tenant and
// write the audit log. Nothing here posts to any platform.

const LIBRARY = "/admin/marketing/library";
const POSTS = "/admin/marketing/posts";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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
    if (error instanceof ContentError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function addLibraryFileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("content.write");
  const values = {
    title: field(formData, "title"),
    altText: field(formData, "altText"),
    tags: field(formData, "tags"),
    usageNote: field(formData, "usageNote"),
  };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo or video.", values };
  }
  if (file.size > MAX_UPLOAD_BYTES)
    return { error: "The file is too large (8 MB at most).", values };
  return attempt(async () => {
    await addLibraryFile(
      tenantDb(context),
      context,
      mediaDeps(),
      new Uint8Array(await file.arrayBuffer()),
      values,
    );
    revalidatePath(LIBRARY);
    return { notice: "Added to the library." };
  }, values);
}

export async function updateLibraryFileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("content.write");
  const id = field(formData, "id");
  const archived = formData.get("archived") === "on";
  return attempt(async () => {
    await updateLibraryFile(tenantDb(context), context, id, {
      title: field(formData, "title"),
      altText: field(formData, "altText"),
      tags: field(formData, "tags"),
      usageNote: field(formData, "usageNote"),
      archived,
    });
    revalidatePath(LIBRARY);
    return { notice: archived ? "Archived." : "Saved." };
  });
}

const postValues = (formData: FormData) => ({
  title: field(formData, "title"),
  channel: field(formData, "channel"),
  format: field(formData, "format"),
  caption: field(formData, "caption"),
  plannedFor: field(formData, "plannedFor"),
});
const postInput = (formData: FormData) => ({
  ...postValues(formData),
  fileIds: formData.getAll("fileIds").filter((v): v is string => typeof v === "string"),
  productIds: formData.getAll("productIds").filter((v): v is string => typeof v === "string"),
});

export async function createPostAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("content.write");
  let id = "";
  const result = await attempt(async () => {
    ({ id } = await createPost(tenantDb(context), context, postInput(formData)));
    return {};
  }, postValues(formData));
  if (result.error) return result;
  revalidatePath(POSTS);
  redirect(`${POSTS}/${id}`);
}

export async function updatePostAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("content.write");
  const id = field(formData, "id");
  return attempt(async () => {
    const { backToDraft } = await updatePost(tenantDb(context), context, id, postInput(formData));
    revalidatePath(POSTS);
    revalidatePath(`${POSTS}/${id}`);
    return {
      notice: backToDraft
        ? "Saved. The post changed, so it is back to draft and needs approval again."
        : "Saved.",
    };
  }, postValues(formData));
}

const STEP_NOTICE = {
  submit: "Sent for approval.",
  unsubmit: "Taken back to draft.",
  approve: "Approved.",
  request_changes: "Sent back with your note.",
  publish: "Marked as published.",
} as const;

const STEP_PERMISSION = {
  submit: "content.write",
  unsubmit: "content.write",
  approve: "content.approve",
  request_changes: "content.approve",
  publish: "social.publish",
} as const;

export async function movePostAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const step = field(formData, "step") as keyof typeof STEP_NOTICE;
  const { context } = await requirePermission("content.write");
  if (!(step in STEP_NOTICE)) return { error: "Choose what to do." };
  // Approving and publishing need more than writing; the service checks again.
  if (!hasPermission(context, STEP_PERMISSION[step])) {
    return { error: "You do not have permission to do that." };
  }
  const id = field(formData, "id");
  return attempt(async () => {
    await movePost(tenantDb(context), context, id, step, {
      note: field(formData, "note"),
      url: field(formData, "url"),
    });
    revalidatePath(POSTS);
    revalidatePath(`${POSTS}/${id}`);
    return { notice: STEP_NOTICE[step] };
  });
}

export async function deletePostAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("content.write");
  const result = await attempt(async () => {
    await deletePost(tenantDb(context), context, field(formData, "id"));
    return {};
  });
  if (result.error) return result;
  revalidatePath(POSTS);
  redirect(POSTS);
}

export interface CaptionDraftState {
  error?: string;
  caption?: string;
}

/** An AI caption draft for staff to use or ignore. Nothing is saved. */
export async function draftCaptionAction(
  _previous: CaptionDraftState,
  formData: FormData,
): Promise<CaptionDraftState> {
  const { context } = await requirePermission("content.write");
  try {
    const result = await draftPostCaption(
      tenantDb(context),
      context,
      aiGateway(context.userId),
      field(formData, "id"),
      { language: field(formData, "language"), brief: field(formData, "brief") },
    );
    return result.ok ? { caption: result.caption } : { error: result.message };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}
