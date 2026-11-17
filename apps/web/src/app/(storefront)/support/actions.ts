"use server";

import { getEnv } from "@ecom/config";
import { NotFoundError, replyAsShopper, startConversation, SupportError } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tooManyCartChanges } from "@/server/cart";
import { getCurrentCustomer } from "@/server/customer";
import { shopLocale } from "@/server/i18n";
import { sendWaitingEmails } from "@/server/notifications";
import { storefrontDb } from "@/server/storefront";
import type { AccountFormState } from "../account/actions";

// Shoppers writing to the store. The store comes from the host name
// (storefrontDb); a signed-in customer comes from their session, a guest's
// conversation opens only with the key from their emailed link. A hidden
// "website" field catches simple bots: people never fill it in.

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function startConversationAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { store, db } = await storefrontDb();
  const values = {
    name: text(formData, "name"),
    email: text(formData, "email"),
    subject: text(formData, "subject"),
    message: text(formData, "message"),
    orderNumber: text(formData, "orderNumber"),
  };
  if (text(formData, "website")) return { notice: "Thank you. Your message was sent." };
  if (await tooManyCartChanges(store.tenantId)) {
    return { error: "Too many attempts in a short time. Please wait a minute.", values };
  }
  const customer = await getCurrentCustomer();
  let next: string;
  try {
    const started = await startConversation(db, {
      customer: customer ? { id: customer.id, email: customer.email, name: customer.name } : null,
      ...values,
      accessSecret: getEnv().ENCRYPTION_KEY,
      locale: await shopLocale(),
    });
    next = customer
      ? `/account/messages/${started.id}?sent=1`
      : `/support/${started.id}?key=${encodeURIComponent(started.accessKey)}&sent=1`;
  } catch (error) {
    if (error instanceof SupportError) return { error: error.message, values };
    throw error;
  }
  await sendWaitingEmails(db);
  redirect(next);
}

export async function replyToConversationAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { store, db } = await storefrontDb();
  const values = { message: text(formData, "message") };
  if (await tooManyCartChanges(store.tenantId)) {
    return { error: "Too many attempts in a short time. Please wait a minute.", values };
  }
  const customer = await getCurrentCustomer();
  const id = text(formData, "id");
  try {
    await replyAsShopper(
      db,
      id,
      { customerId: customer?.id ?? null, accessKey: text(formData, "key") || null },
      values.message,
    );
  } catch (error) {
    if (error instanceof SupportError) return { error: error.message, values };
    if (error instanceof NotFoundError) return { error: "This conversation could not be found." };
    throw error;
  }
  await sendWaitingEmails(db);
  revalidatePath(`/account/messages/${id}`);
  revalidatePath(`/support/${id}`);
  return { notice: "Sent. We will reply by email." };
}
