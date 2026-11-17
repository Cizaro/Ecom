import "server-only";

import { getEnv } from "@ecom/config";
import { createTranslator, isLocale, type Locale, type Translator } from "@ecom/i18n";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { AREA_HEADER, PATH_HEADER } from "./area";
import { findStorefront, requireStorefront } from "./storefront";

// The shop language for this request. English (the store's default) unless
// the shopper picked another language the store offers; the choice is kept
// in a cookie for a year. Staff pages are always English.

export const LANG_COOKIE = "lang";
const LANG_DAYS = 365;

function chosen(store: { defaultLocale: Locale; languages: Locale[] }, value: string | undefined) {
  return isLocale(value) && store.languages.includes(value) ? value : store.defaultLocale;
}

/** The language shop pages are shown in. */
export const shopLocale = cache(async (): Promise<Locale> => {
  const store = await requireStorefront();
  return chosen(store, (await cookies()).get(LANG_COOKIE)?.value);
});

/** Wording for shop pages, in the shopper's language. */
export const shopT = cache(async (): Promise<Translator> => createTranslator(await shopLocale()));

/**
 * For the page's <html lang dir>: the shop language on shop pages, English
 * on staff pages and for host names that are not a store.
 */
export async function documentLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  if (requestHeaders.get(AREA_HEADER) !== "shop") return "en";
  const store = await findStorefront();
  return store ? chosen(store, (await cookies()).get(LANG_COOKIE)?.value) : "en";
}

/** The page being shown, for the language switch to come back to. */
export async function currentPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "/";
}

/** Remembers the shopper's language. Only callable from a server action. */
export async function writeLanguage(locale: Locale): Promise<void> {
  (await cookies()).set(LANG_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(getEnv().APP_URL).protocol === "https:",
    path: "/",
    maxAge: LANG_DAYS * 24 * 60 * 60,
  });
}
