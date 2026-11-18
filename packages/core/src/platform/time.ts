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

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** The instant a wall-clock time ("2026-11-21T18:00") is in the zone, or null if not one. */
export function zonedDateTime(local: string, timeZone: string): Date | null {
  const match = LOCAL.exec(local);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  const dayStart = zonedDayStart(match[1]!, timeZone);
  if (!dayStart) return null;
  const guess = new Date(dayStart.getTime() + (hours * 60 + minutes) * 60_000);
  // A clock change during the day moves the wall clock against the guess.
  const drift = offsetMinutes(guess, timeZone) - offsetMinutes(dayStart, timeZone);
  return new Date(guess.getTime() - drift * 60_000);
}

/** An instant as the zone's wall-clock time, for a form field ("2026-11-21T18:00"). */
export function zonedLocalInput(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
