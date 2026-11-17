"use server";

import { addCustomerNote, CustomerNoteError, ForbiddenError, NotFoundError } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// Notes on customers. The action checks customers.write itself; the service
// checks it again, runs inside the staff member's tenant and writes the audit log.

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function addCustomerNoteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("customers.write");
  const id = field(formData, "id");
  const values = { note: field(formData, "note") };
  try {
    await addCustomerNote(tenantDb(context), context, id, values.note);
  } catch (error) {
    if (error instanceof CustomerNoteError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
  revalidatePath(`/admin/customers/${id}`);
  return { notice: "Note added." };
}
