import { describe, expect, it } from "vitest";
import { forecastSales, percent, stockRunOut, type DayFigures } from "./forecast";

/** `weeks` weeks of history ending on 2026-11-28 (a Saturday), Saturdays selling `saturday`. */
function history(weeks: number, saturday: number, otherDays: number): DayFigures[] {
  const days: DayFigures[] = [];
  const end = new Date("2026-11-28T00:00:00Z");
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const sales = d.getUTCDay() === 6 ? saturday : otherDays;
    days.push({ day: d.toISOString().slice(0, 10), orders: sales > 0 ? 1 : 0, sales });
  }
  return days;
}

describe("forecastSales", () => {
  it("expects each weekday to sell what that weekday sold on average", () => {
    const forecast = forecastSales(history(8, 10_000, 2_000), "2026-11-28");
    expect(forecast.enough).toBe(true);
    expect(forecast.days).toHaveLength(14);
    expect(forecast.days[0]).toEqual({
      day: "2026-11-29",
      expected: 2_000,
      low: 2_000,
      high: 2_000,
    });
    // 2026-12-05 is a Saturday.
    expect(forecast.days.find((d) => d.day === "2026-12-05")?.expected).toBe(10_000);
    expect(forecast.total.expected).toBe(2 * 10_000 + 12 * 2_000);
  });

  it("gives the lowest and highest week as the range", () => {
    const days = history(2, 0, 0);
    // Two Saturdays: 1,000 and 3,000.
    const saturdays = days.filter((d) => new Date(`${d.day}T00:00:00Z`).getUTCDay() === 6);
    saturdays[0]!.sales = 1_000;
    saturdays[1]!.sales = 3_000;
    const next = forecastSales(days, "2026-11-28", 7).days.find((d) => d.day === "2026-12-05")!;
    expect(next).toEqual({ day: "2026-12-05", expected: 2_000, low: 1_000, high: 3_000 });
  });

  it("says when there is too little history to project", () => {
    expect(forecastSales(history(1, 5_000, 5_000), "2026-11-28").enough).toBe(false);
    expect(forecastSales([], "2026-11-28").total).toEqual({ expected: 0, low: 0, high: 0 });
  });

  it("ignores days after today", () => {
    const days = [...history(8, 0, 0), { day: "2026-12-01", orders: 99, sales: 999_999 }];
    expect(forecastSales(days, "2026-11-28").total.expected).toBe(0);
  });
});

describe("stockRunOut", () => {
  const line = (sku: string, available: number, sold: number) => ({
    variantId: sku,
    productName: sku,
    sku,
    available,
    soldLast28Days: sold,
  });

  it("lists what runs out soonest at the recent pace", () => {
    const result = stockRunOut([
      line("SLOW", 100, 28), // 1 a day: 100 days
      line("FAST", 10, 56), // 2 a day: 5 days
      line("GONE", 0, 14), // already out
      line("NEVER", 3, 0), // not selling
    ]);
    expect(result.map((r) => [r.sku, r.daysLeft])).toEqual([
      ["GONE", 0],
      ["FAST", 5],
    ]);
  });

  it("treats negative availability as none", () => {
    expect(stockRunOut([line("OVER", -2, 28)])[0]!.daysLeft).toBe(0);
  });
});

describe("percent", () => {
  it("rounds to one decimal and needs a whole", () => {
    expect(percent(1, 8)).toBe("12.5");
    expect(percent(2, 3)).toBe("66.7");
    expect(percent(1, 0)).toBeNull();
  });
});
