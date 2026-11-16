// Dates in a store's own time zone. "Today" on the dashboard and date
// filters on orders mean the store's day, not the server's (which runs on UTC).

/** The time zone if the runtime knows it, otherwise UTC. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Minutes the zone is ahead of UTC at that instant (Beirut in winter: 120). */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a string is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
  return date.toISOString().slice(0, 10) === value;
}

/** The instant a calendar day (YYYY-MM-DD) starts in the zone, or null if not a date. */
export function zonedDayStart(day: string, timeZone: string): Date | null {
  if (!isCalendarDate(day)) return null;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d);
  const first = offsetMinutes(new Date(midnightUtc), timeZone);
  let start = midnightUtc - first * 60_000;
  // Near a clock change the offset at local midnight can differ from the guess.
  const second = offsetMinutes(new Date(start), timeZone);
  if (second !== first) start = midnightUtc - second * 60_000;
  return new Date(start);
}

/** The calendar day (YYYY-MM-DD) an instant falls on in the zone. */
export function zonedDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** A calendar day plus or minus whole days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
