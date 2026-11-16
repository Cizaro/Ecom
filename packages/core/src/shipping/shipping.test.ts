import { describe, expect, it } from "vitest";
import {
  deliveryFee,
  describeZone,
  formatTaxRate,
  NO_TAX,
  parseCountries,
  parseTaxRate,
  priceOrder,
  pricingVersion,
  ShippingError,
  type ShippingZoneView,
} from "./shipping";

const zone = (overrides: Partial<ShippingZoneView> = {}): ShippingZoneView => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Beirut",
  countries: ["LB"],
  rateAmount: 300,
  freeOverAmount: null,
  currency: "USD",
  isActive: true,
  position: 0,
  ...overrides,
});

describe("delivery fee", () => {
  it("charges the area's price", () => {
    expect(deliveryFee(zone(), 5_000)).toBe(300);
  });

  it("is free from the free-delivery amount upwards, not below it", () => {
    const area = zone({ freeOverAmount: 10_000 });
    expect(deliveryFee(area, 9_999)).toBe(300);
    expect(deliveryFee(area, 10_000)).toBe(0);
  });
});

describe("pricing an order", () => {
  it("adds nothing when there is no area and no tax", () => {
    expect(priceOrder(4_000, null, NO_TAX)).toEqual({
      subtotalAmount: 4_000,
      shippingAmount: 0,
      taxAmount: 0,
      taxIncludedAmount: 0,
      totalAmount: 4_000,
    });
  });

  it("adds tax on items and delivery when prices exclude it", () => {
    const priced = priceOrder(10_000, zone(), {
      rateBasisPoints: 1100,
      included: false,
      label: "VAT",
    });
    // (100.00 + 3.00) * 11% = 11.33
    expect(priced).toMatchObject({ shippingAmount: 300, taxAmount: 1133, totalAmount: 11_433 });
    expect(priced.totalAmount).toBe(
      priced.subtotalAmount + priced.shippingAmount + priced.taxAmount,
    );
  });

  it("shows the tax inside the total, without changing it, when prices include it", () => {
    const priced = priceOrder(11_100, null, {
      rateBasisPoints: 1100,
      included: true,
      label: "VAT",
    });
    expect(priced).toMatchObject({ taxAmount: 0, taxIncludedAmount: 1100, totalAmount: 11_100 });
  });

  it("rounds half a cent up", () => {
    // 0.05 * 10% = 0.005 -> 0.01
    expect(
      priceOrder(5, null, { rateBasisPoints: 1000, included: false, label: "VAT" }).taxAmount,
    ).toBe(1);
    expect(
      priceOrder(4, null, { rateBasisPoints: 1000, included: false, label: "VAT" }).taxAmount,
    ).toBe(0);
  });
});

describe("what staff type", () => {
  it("reads country codes in any case, once each", () => {
    expect(parseCountries("lb, LB sy")).toEqual(["LB", "SY"]);
  });

  it("refuses unknown or missing country codes", () => {
    expect(() => parseCountries("")).toThrow(ShippingError);
    expect(() => parseCountries("LB, XX")).toThrow(/"XX" is not a country code/);
    expect(() => parseCountries("Lebanon")).toThrow(ShippingError);
  });

  it("reads tax rates as percentages up to 50", () => {
    expect(parseTaxRate("11")).toBe(1100);
    expect(parseTaxRate("12.5%")).toBe(1250);
    expect(parseTaxRate("0")).toBe(0);
    for (const bad of ["51", "-1", "eleven", "1.234", ""]) {
      expect(() => parseTaxRate(bad)).toThrow(ShippingError);
    }
  });

  it("describes rates the way shoppers read them", () => {
    expect(formatTaxRate(1100)).toBe("11%");
    expect(formatTaxRate(1250)).toBe("12.5%");
    expect(describeZone(zone({ freeOverAmount: 10_000 }))).toBe("Beirut: $3.00, free over $100.00");
    expect(describeZone(zone({ rateAmount: 0 }))).toBe("Beirut: free delivery");
  });
});

describe("price fingerprint", () => {
  it("changes when a price or the tax changes, and only then", () => {
    const base = pricingVersion([zone()], NO_TAX);
    expect(pricingVersion([zone()], NO_TAX)).toBe(base);
    expect(pricingVersion([zone({ rateAmount: 400 })], NO_TAX)).not.toBe(base);
    expect(pricingVersion([zone()], { ...NO_TAX, rateBasisPoints: 1100 })).not.toBe(base);
    expect(pricingVersion([zone({ position: 5 })], NO_TAX)).toBe(base);
  });
});
