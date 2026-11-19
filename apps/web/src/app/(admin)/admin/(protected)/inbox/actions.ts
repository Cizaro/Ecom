"use server";

import {
  checkInstagramNow,
  deliverSocialReply,
  dismissSupportDraft,
  isMetaError,
  retrySocialReply,
  draftSupportReply,
  ForbiddenError,
  NotFoundError,
  replyAsStaff,
  SupportError,
  updateConversation,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { aiGateway } from "@/server/ai";
import { requirePermission, tenantDb } from "@/server/access";
import { sendWaitingEmails } from "@/server/notifications";
import { socialDeps } from "@/server/social";
import type { FormState } from "../../actions";

// Support inbox. Every action checks inbox.reply itself; the services check
// it again, run inside the staff member's tenant and write the audit log.

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
    if (error instanceof SupportError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function replyToConversationStaffAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inbox.reply");
  const id = field(formData, "id");
  const internal = formData.get("internal") === "on";
  const values = { message: field(formData, "message") };
  return attempt(async () => {
    const db = tenantDb(context);
    const saved = await replyAsStaff(db, context, id, {
      message: values.message,
      internal,
      draftId: field(formData, "draftId") || undefined,
    });
    // Instagram and Facebook replies go through Meta now; others are emailed.
    const delivery = saved.social
      ? await deliverSocialReply(db, socialDeps(), saved.messageId)
      : null;
    if (!internal && !saved.social) await sendWaitingEmails(db);
    revalidatePath("/admin/inbox");
    revalidatePath(`/admin/inbox/${id}`);
    if (delivery && !delivery.ok) {
      return { error: `Saved, but not sent: ${delivery.error} Use "Try again" on the reply.` };
    }
    return { notice: internal ? "Note added (staff only)." : "Reply sent." };
  }, values);
}

/** Sends a failed Instagram or Facebook reply again. */
export async function retrySocialReplyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inbox.reply");
  const id = field(formData, "id");
  return attempt(async () => {
    const result = await retrySocialReply(
      tenantDb(context),
      context,
      socialDeps(),
      field(formData, "messageId"),
    );
    revalidatePath(`/admin/inbox/${id}`);
    return result.ok ? { notice: "Reply sent." } : { error: `Not sent: ${result.error}` };
  });
}

/** Reads recent Instagram messages and comments now (the backup check). */
export async function checkInstagramNowAction(_previous: FormState): Promise<FormState> {
  const { context } = await requirePermission("inbox.reply");
  const deps = socialDeps();
  if (!deps) return { error: "Meta is not set up for this installation." };
  try {
    const result = await checkInstagramNow(tenantDb(context), deps);
    revalidatePath("/admin/inbox");
    return {
      notice:
        result.newConversations > 0
          ? `${result.newConversations} new conversation(s) from Instagram.`
          : "Checked: nothing new from Instagram.",
    };
  } catch (error) {
    if (isMetaError(error)) return { error: error.message };
    throw error;
  }
}

export async function updateConversationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inbox.reply");
  const id = field(formData, "id");
  const status = field(formData, "status");
  const assign = field(formData, "assign");
  return attempt(async () => {
    await updateConversation(tenantDb(context), context, id, {
      ...(status ? { status } : {}),
      ...(assign === "me" || assign === "nobody" ? { assign } : {}),
    });
    revalidatePath("/admin/inbox");
    revalidatePath(`/admin/inbox/${id}`);
    return { notice: "Saved." };
  });
}

/** A new AI draft of a reply (staff edit and send it; nothing is sent here). */
export async function draftSupportReplyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inbox.reply");
  const id = field(formData, "id");
  return attempt(async () => {
    const result = await draftSupportReply(
      tenantDb(context),
      context,
      aiGateway(context.userId),
      id,
    );
    revalidatePath(`/admin/inbox/${id}`);
    return result.ok
      ? { notice: "Draft ready below. Check it before sending." }
      : { error: result.message };
  });
}

export async function dismissSupportDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("inbox.reply");
  const id = field(formData, "id");
  return attempt(async () => {
    await dismissSupportDraft(tenantDb(context), context, id, field(formData, "draftId"));
    revalidatePath(`/admin/inbox/${id}`);
    return { notice: "Draft dismissed." };
  });
}
