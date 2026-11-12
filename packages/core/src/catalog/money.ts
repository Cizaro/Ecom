// Money is an integer number of minor units (cents) plus an ISO 4217 currency
// code. Nothing here uses floating-point arithmetic on amounts.

/** Largest amount the database column (32-bit integer) can hold. */
export const MAX_MONEY_AMOUNT = 2_147_483_647;

const CURRENCY = /^[A-Z]{3}$/;

export function isCurrencyCode(value: string): boolean {
  if (!CURRENCY.test(value)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
}

/** Decimal places the currency uses: 2 for USD, 0 for JPY, 3 for KWD. */
export function currencyExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * Parses what a person typed ("49", "49.9", "1,299.00") into minor units.
 * Returns null for anything that is not a plain non-negative amount with at
 * most the currency's number of decimal places.
 */
export function parseMoney(input: string, currency: string): number | null {
  const exponent = currencyExponent(currency);
  const cleaned = input.trim().replace(/,(?=\d{3}(\D|$))/g, "");
  const match = /^(\d{1,10})(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const amount = Number(match[1] + fraction.padEnd(exponent, "0"));
  return Number.isSafeInteger(amount) && amount <= MAX_MONEY_AMOUNT ? amount : null;
}

/** Minor units as a plain decimal for a form field: 4990 -> "49.90". */
export function moneyToInput(amount: number, currency: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(amount);
  const digits = String(amount).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** Minor units for display: 4990, "USD" -> "$49.90". */
export function formatMoney(amount: number, currency: string, locale = "en"): string {
  const exponent = currencyExponent(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    // Exact for every amount the column can hold.
    amount / 10 ** exponent,
  );
}
