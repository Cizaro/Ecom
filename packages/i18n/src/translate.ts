// Shop languages. English is the default and the source text: every piece of
// wording is written in English in the code, and that English is also the
// key for its translation. A missing translation shows the English, never a
// blank or a key name. Pure functions, no database: usable on the server, in
// the browser, in emails and by any future client (see docs/REUSE.md).

import { ar } from "./ar";

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export interface LocaleInfo {
  /** The language's name in itself, for the language switch. */
  label: string;
  dir: "ltr" | "rtl";
  /**
   * For Intl formatting. Arabic keeps Western digits (1, 2, 3): it is what
   * shops and customers in Lebanon use for prices and phone numbers.
   */
  intl: string;
  /**
   * For amounts of money. Arabic prices are written as in Lebanese shops:
   * "$49.90", with a decimal point (Arabic number formatting would give "49,90 US$").
   */
  moneyIntl: string;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { label: "English", dir: "ltr", intl: "en", moneyIntl: "en" },
  ar: { label: "العربية", dir: "rtl", intl: "ar-LB-u-nu-latn", moneyIntl: "en" },
};

/** One phrase whose wording depends on a number (Arabic has six forms). */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type CatalogEntry = string | PluralForms;
/** Translations of one language, keyed by the English text. */
export type Catalog = Readonly<Record<string, CatalogEntry>>;

/**
 * English forms for phrases that change with a number. The key is the
 * general ("other") form used in the code: t("{count} items", { count }).
 */
const en: Catalog = {
  "{count} items": { one: "{count} item", other: "{count} items" },
  "{count} products": { one: "{count} product", other: "{count} products" },
  "{count} reviews": { one: "{count} review", other: "{count} reviews" },
  "{count} colours": { one: "{count} colour", other: "{count} colours" },
};

const CATALOGS: Record<Locale, Catalog> = { en, ar };

type Vars = Readonly<Record<string, string | number>>;

export interface Translator {
  readonly locale: Locale;
  readonly dir: "ltr" | "rtl";
  readonly intl: string;
  /** The wording in this language, with {name} filled from vars. */
  (text: string, vars?: Vars): string;
  /**
   * A message made elsewhere in English (an error from a service), in this
   * language. Messages with a value in them ("Only 3 of this item are left.")
   * are matched against the catalog's patterns.
   */
  message(text: string): string;
  /** Minor units for display: 4990, "USD" -> "$49.90" (or "‏49.90 US$"). */
  money(amount: number, currency: string): string;
  date(value: Date, options?: Intl.DateTimeFormatOptions): string;
}

function fill(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

function pick(entry: CatalogEntry, vars: Vars | undefined, rules: Intl.PluralRules): string {
  if (typeof entry === "string") return entry;
  const count = Number(vars?.count);
  const rule = Number.isFinite(count) ? rules.select(count) : "other";
  return entry[rule] ?? entry.other;
}

interface Pattern {
  regex: RegExp;
  names: string[];
  key: string;
}

const patternCache = new Map<Catalog, Pattern[]>();

/** Catalog keys with {placeholders}, as regular expressions over the English. */
function patternsOf(catalog: Catalog): Pattern[] {
  let patterns = patternCache.get(catalog);
  if (patterns) return patterns;
  patterns = [];
  for (const key of Object.keys(catalog)) {
    if (!key.includes("{")) continue;
    const names: string[] = [];
    const source = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        if (name) {
          names.push(name);
          return "(.+?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    patterns.push({ regex: new RegExp("^" + source + "$", "s"), names, key });
  }
  // The most specific first: "Only {count} of this item are left." before "{number} of {count}".
  const literal = (key: string) => key.replace(/\{\w+\}/g, "").length;
  patterns.sort((a, b) => literal(b.key) - literal(a.key));
  patternCache.set(catalog, patterns);
  return patterns;
}

/**
 * Marks wording kept in a table and translated where it is shown, t(value).
 * Returns the text unchanged; the completeness test finds the marked text.
 */
export const msg = (text: string): string => text;

export function createTranslator(locale: Locale): Translator {
  const info = LOCALE_INFO[locale];
  const catalog = CATALOGS[locale];
  const rules = new Intl.PluralRules(info.intl);

  const t = ((text: string, vars?: Vars) => {
    const entry = catalog[text];
    return fill(entry === undefined ? text : pick(entry, vars, rules), vars);
  }) as Translator;

  t.message = (text: string) => {
    const entry = catalog[text];
    if (entry !== undefined) return pick(entry, undefined, rules);
    if (locale === DEFAULT_LOCALE) return text;
    for (const pattern of patternsOf(catalog)) {
      const match = pattern.regex.exec(text);
      if (!match) continue;
      const vars: Record<string, string> = {};
      // A value inside a message may itself be wording ("Enter the city.").
      pattern.names.forEach((name, i) => (vars[name] = t(match[i + 1] ?? "")));
      return t(pattern.key, vars);
    }
    return text;
  };

  t.money = (amount: number, currency: string) => {
    const format = new Intl.NumberFormat(info.moneyIntl, { style: "currency", currency });
    const exponent = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amount / 10 ** exponent);
  };

  t.date = (value: Date, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
    new Intl.DateTimeFormat(info.intl, options).format(value);

  Object.defineProperties(t, {
    locale: { value: locale },
    dir: { value: info.dir },
    intl: { value: info.intl },
  });
  return t;
}

/** The keys a catalog translates, for the completeness test. */
export function catalogKeys(locale: Locale): string[] {
  return Object.keys(CATALOGS[locale]);
}

/** Whether a piece of English wording has a translation (directly or by pattern). */
export function isTranslated(locale: Locale, text: string): boolean {
  const catalog = CATALOGS[locale];
  if (catalog[text] !== undefined) return true;
  return patternsOf(catalog).some((p) => p.regex.test(text));
}
