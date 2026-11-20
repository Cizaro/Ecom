import { describe, expect, it } from "vitest";
import { addMonths, billingState } from "./billing";

const now = new Date("2026-12-10T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe("addMonths", () => {
  it("keeps the day of the month", () => {
    expect(addMonths(new Date("2026-01-15T10:00:00Z"), 1).toISOString()).toBe(
      "2026-02-15T10:00:00.000Z",
    );
    expect(addMonths(new Date("2026-11-30T00:00:00Z"), 3).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("uses the last day when the month is shorter", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("crosses years", () => {
    expect(addMonths(new Date("2026-12-01T00:00:00Z"), 12).toISOString()).toBe(
      "2027-12-01T00:00:00.000Z",
    );
  });
});

describe("billingState", () => {
  const trial = (end: Date) => ({ plan: "trial", trialEndsAt: end, paidUntil: null });

  it("follows a trial to its end", () => {
    expect(billingState(trial(days(10)), now)).toBe("trial");
    expect(billingState(trial(days(2)), now)).toBe("trial_ending");
    expect(billingState(trial(days(-1)), now)).toBe("trial_ended");
  });

  it("follows a paid period to its end", () => {
    const paid = (until: Date) => ({ plan: "starter", trialEndsAt: null, paidUntil: until });
    expect(billingState(paid(days(20)), now)).toBe("paid");
    expect(billingState(paid(days(1)), now)).toBe("renewal_due");
    expect(billingState(paid(days(-1)), now)).toBe("overdue");
  });

  it("counts a payment over a trial that has ended", () => {
    expect(billingState({ plan: "starter", trialEndsAt: days(-5), paidUntil: days(25) }, now)).toBe(
      "paid",
    );
  });

  it("leaves shops set up by hand alone until a payment is recorded", () => {
    expect(billingState({ plan: null, trialEndsAt: null, paidUntil: null }, now)).toBe("managed");
    expect(billingState({ plan: "starter", trialEndsAt: null, paidUntil: null }, now)).toBe(
      "managed",
    );
  });
});
