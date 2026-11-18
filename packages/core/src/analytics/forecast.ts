// Forecasts for the reports page (Milestone 7.4, decision D110). Deliberately
// simple and explainable: a day is expected to sell what the same weekday sold
// on average over the last 8 weeks, with the lowest and highest of those weeks
// as the range. Stock running out is today's available stock divided by the
// average units sold per day over the last 28 days. No model, no guessing
// beyond the store's own recorded orders.

export interface DayFigures {
  /** YYYY-MM-DD in the store's time zone. */
  day: string;
  orders: number;
  /** Minor units. */
  sales: number;
}

export interface ForecastDay {
  day: string;
  expected: number;
  low: number;
  high: number;
}

export interface SalesForecast {
  /** False when fewer than 14 days of history had any sales: too little to project. */
  enough: boolean;
  days: ForecastDay[];
  total: { expected: number; low: number; high: number };
}

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

function nextDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Projects sales for the `horizon` days after `today`, from up to the last 8
 * weeks of `history` (oldest first, one entry per day, days without orders
 * included as zero).
 */
export function forecastSales(history: DayFigures[], today: string, horizon = 14): SalesForecast {
  const recent = history.filter((d) => d.day <= today).slice(-56);
  const daysWithSales = recent.filter((d) => d.sales > 0).length;
  const byWeekday = new Map<number, number[]>();
  for (const d of recent) {
    const list = byWeekday.get(weekday(d.day)) ?? [];
    list.push(d.sales);
    byWeekday.set(weekday(d.day), list);
  }
  const days: ForecastDay[] = [];
  for (let i = 1; i <= horizon; i += 1) {
    const day = nextDay(today, i);
    const seen = byWeekday.get(weekday(day)) ?? [];
    const expected = seen.length ? Math.round(seen.reduce((a, b) => a + b, 0) / seen.length) : 0;
    days.push({
      day,
      expected,
      low: seen.length ? Math.min(...seen) : 0,
      high: seen.length ? Math.max(...seen) : 0,
    });
  }
  const sum = (key: "expected" | "low" | "high") => days.reduce((a, d) => a + d[key], 0);
  return {
    enough: daysWithSales >= 14,
    days,
    total: { expected: sum("expected"), low: sum("low"), high: sum("high") },
  };
}

export interface StockLine {
  variantId: string;
  productName: string;
  sku: string;
  /** On hand less held and damaged, never below zero. */
  available: number;
  /** Units sold in the last 28 days. */
  soldLast28Days: number;
}

export interface RunOut extends StockLine {
  /** Whole days until it runs out at the recent pace; 0 when it already has. */
  daysLeft: number;
}

/** Products that will run out within `withinDays` at the pace of the last 28 days, soonest first. */
export function stockRunOut(lines: StockLine[], withinDays = 21): RunOut[] {
  return lines
    .filter((line) => line.soldLast28Days > 0)
    .map((line) => ({
      ...line,
      daysLeft: Math.max(0, Math.floor(Math.max(0, line.available) / (line.soldLast28Days / 28))),
    }))
    .filter((line) => line.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || b.soldLast28Days - a.soldLast28Days);
}

/** Part of a whole as a percentage with one decimal ("12.5"), or null without a whole. */
export function percent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return (Math.round((part / whole) * 1000) / 10).toFixed(1);
}
