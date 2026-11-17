"use server";

import { isLocale } from "@ecom/i18n";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/server/customer";
import { writeLanguage } from "@/server/i18n";
import { storefrontDb } from "@/server/storefront";

// The language switch in the shop header. Only a language the store offers
// is kept; the shopper comes back to the page they were on (a path on this
// site only, never another address).

export async function setLanguageAction(formData: FormData): Promise<void> {
  const { store } = await storefrontDb();
  const locale = formData.get("locale");
  if (isLocale(locale) && store.languages.includes(locale)) await writeLanguage(locale);
  redirect(safeReturnPath(formData.get("returnTo"), "/"));
}
