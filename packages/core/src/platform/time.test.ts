import { describe, expect, it } from "vitest";
import { csvField } from "../reports/reports";
import { addDays, isCalendarDate, safeTimeZone, zonedDay, zonedDayStart } from "./time";

describe("store days", () => {
  it("start at local midnight in the store's time zone", () => {
    // Beirut is UTC+2 in winter and UTC+3 in summer.
    expect(zonedDayStart("2026-01-15", "Asia/Beirut")!.toISOString()).toBe(
      "2026-01-14T22:00:00.000Z",
    );
    expect(zonedDayStart("2026-07-15", "Asia/Beirut")!.toISOString()).toBe(
      "2026-07-14T21:00:00.000Z",
    );
    expect(zonedDayStart("2026-07-15", "UTC")!.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("put an instant on the store's calendar day", () => {
    // 23:30 UTC on the 14th is already the 15th in Beirut.
    expect(zonedDay(new Date("2026-01-14T23:30:00Z"), "Asia/Beirut")).toBe("2026-01-15");
    expect(zonedDay(new Date("2026-01-14T23:30:00Z"), "UTC")).toBe("2026-01-14");
  });

  it("refuse dates that do not exist, and unknown time zones fall back to UTC", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-2-3")).toBe(false);
    expect(zonedDayStart("not-a-date", "UTC")).toBeNull();
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone("Asia/Beirut")).toBe("Asia/Beirut");
  });

  it("count days across month ends", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("CSV fields", () => {
  it("quote commas, quotes and line breaks", () => {
    expect(csvField('Tote, "large"')).toBe('"Tote, ""large"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(42)).toBe("42");
  });

  it("stop a spreadsheet from running text as a formula", () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField("+961 3 123 456")).toBe("'+961 3 123 456");
    expect(csvField("@sum")).toBe("'@sum");
    expect(csvField("-5")).toBe("'-5");
  });
});
