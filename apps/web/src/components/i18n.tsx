"use client";

import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from "@ecom/i18n";
import { createContext, useContext, useMemo, type ReactNode } from "react";

// Gives the shop's browser-side components the shopper's language. The shop
// layout sets it from the server's choice (server/i18n.ts).

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Wording in the shopper's language, for browser-side components. */
export function useT(): Translator {
  const locale = useContext(LocaleContext);
  return useMemo(() => createTranslator(locale), [locale]);
}
