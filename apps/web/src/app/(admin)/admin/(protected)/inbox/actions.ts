"use server";

import {
  ForbiddenError,
  NotFoundError,
  replyAsStaff,
  SupportError,
  updateConversation,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import { sendWaitingEmails } from "@/server/notifications";
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
    await replyAsStaff(db, context, id, { message: values.message, internal });
    if (!internal) await sendWaitingEmails(db);
    revalidatePath("/admin/inbox");
    revalidatePath(`/admin/inbox/${id}`);
    return { notice: internal ? "Note added (staff only)." : "Reply sent." };
  }, values);
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
