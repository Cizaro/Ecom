import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  formatMoney,
  isCurrencyCode,
  MAX_MONEY_AMOUNT,
  moneyToInput,
  parseMoney,
} from "./money";

describe("currency", () => {
  it("knows how many decimal places a currency uses", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("recognises currency codes", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(false);
    expect(isCurrencyCode("US")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
  });
});

describe("parseMoney", () => {
  it("reads whole and decimal amounts into minor units", () => {
    expect(parseMoney("49", "USD")).toBe(4900);
    expect(parseMoney("49.9", "USD")).toBe(4990);
    expect(parseMoney("49.99", "USD")).toBe(4999);
    expect(parseMoney(" 0.05 ", "USD")).toBe(5);
    expect(parseMoney("0", "USD")).toBe(0);
  });

  it("is exact where floating point is not", () => {
    // 19.99 * 100 is 1998.9999999999998 in floating point.
    expect(parseMoney("19.99", "USD")).toBe(1999);
    expect(parseMoney("1.15", "USD")).toBe(115);
  });

  it("accepts thousands separators", () => {
    expect(parseMoney("1,299.00", "USD")).toBe(129900);
    expect(parseMoney("1,000,000", "USD")).toBe(100000000);
  });

  it("respects the currency's decimal places", () => {
    expect(parseMoney("500", "JPY")).toBe(500);
    expect(parseMoney("500.5", "JPY")).toBeNull();
    expect(parseMoney("1.234", "KWD")).toBe(1234);
    expect(parseMoney("1.234", "USD")).toBeNull();
  });

  it("rejects anything that is not a plain non-negative amount", () => {
    for (const value of ["", "abc", "-5", "+5", "1e3", "1.2.3", "$5", "5.", ".5", "1,5", "NaN"]) {
      expect(parseMoney(value, "USD"), value).toBeNull();
    }
  });

  it("rejects amounts too large to store", () => {
    expect(parseMoney("21474836.47", "USD")).toBe(MAX_MONEY_AMOUNT);
    expect(parseMoney("21474836.48", "USD")).toBeNull();
    expect(parseMoney("9999999999", "USD")).toBeNull();
  });
});

describe("moneyToInput", () => {
  it("writes minor units as a plain decimal", () => {
    expect(moneyToInput(4990, "USD")).toBe("49.90");
    expect(moneyToInput(5, "USD")).toBe("0.05");
    expect(moneyToInput(0, "USD")).toBe("0.00");
    expect(moneyToInput(500, "JPY")).toBe("500");
    expect(moneyToInput(1234, "KWD")).toBe("1.234");
  });

  it("round-trips through parseMoney", () => {
    for (const amount of [0, 1, 99, 100, 1999, 129900, MAX_MONEY_AMOUNT]) {
      expect(parseMoney(moneyToInput(amount, "USD"), "USD")).toBe(amount);
    }
  });
});

describe("formatMoney", () => {
  it("formats for display", () => {
    expect(formatMoney(4990, "USD")).toBe("$49.90");
    expect(formatMoney(129900, "USD")).toBe("$1,299.00");
    expect(formatMoney(500, "JPY")).toBe("¥500");
  });
});
