import "server-only";

import {
  CatalogError,
  currencyExponent,
  ForbiddenError,
  NotFoundError,
  parseMoney,
  type CategoryNode,
} from "@ecom/core";
import { forbidden, notFound } from "next/navigation";

// Helpers shared by the catalog pages and server actions: reading form
// fields, turning domain errors into form messages, and option lists.

export interface FormResult {
  error?: string;
  notice?: string;
  values?: Record<string, string>;
}

export const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** What the user typed, to show again after a failed submit. */
export function echo(formData: FormData, names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; state: FormResult };

/**
 * Runs a catalog operation for a form. Problems the user can fix come back
 * as a form message; a missing record (or one in another tenant) is the 404
 * page; a missing permission is the 403 page.
 */
export async function attempt<T>(
  work: () => Promise<T>,
  values?: Record<string, string>,
): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { ok: false, state: { error: error.message, ...(values ? { values } : {}) } };
    }
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

/** For pages: load a record or show the 404 page. */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

/** An amount typed into a form, in minor units. Empty means "not set". */
export function moneyField(
  formData: FormData,
  name: string,
  label: string,
  currency: string,
): number | null {
  const raw = field(formData, name).trim();
  if (raw === "") return null;
  const amount = parseMoney(raw, currency);
  if (amount === null) {
    const places = currencyExponent(currency);
    throw new CatalogError(
      "invalid",
      `The ${label} is not a valid amount. Use digits` +
        (places > 0 ? ` with up to ${places} decimal places, for example 49.90.` : " only."),
      name,
    );
  }
  return amount;
}

/** A whole number typed into a form. Empty means "not set". */
export function wholeNumberField(formData: FormData, name: string, label: string): number | null {
  const raw = field(formData, name).trim();
  if (raw === "") return null;
  if (!/^\d{1,9}$/.test(raw)) {
    throw new CatalogError("invalid", `${label} must be a whole number.`, name);
  }
  return Number(raw);
}

/** "Strap length: 60 cm" per line -> [{ key, value }]. */
export function specificationLines(text: string): { key: string; value: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon < 1 || colon === line.length - 1) {
        throw new CatalogError(
          "invalid",
          `Write each specification as "Name: value". Check the line "${line.slice(0, 60)}".`,
          "specifications",
        );
      }
      return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    });
}

export const tagList = (text: string): string[] =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

/** Category drop-down options, indented to show the tree. */
export function categoryOptions(
  categories: readonly CategoryNode[],
  none: string,
  excludeId?: string,
): { value: string; label: string }[] {
  return [
    { value: "", label: none },
    ...categories
      .filter((category) => category.id !== excludeId)
      .map((category) => ({
        value: category.id,
        label: `${"— ".repeat(category.depth)}${category.name}`,
      })),
  ];
}
