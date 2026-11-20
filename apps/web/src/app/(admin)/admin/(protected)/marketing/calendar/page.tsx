import { postCalendar, zonedDay } from "@ecom/core";
import { Badge, buttonClasses, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE } from "../labels";

export const metadata: Metadata = { title: "Content calendar" };

type Params = Record<string, string | string[] | undefined>;

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
};

// The month's planned posts, by day, in the store's time zone.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("content.write");
  const db = tenantDb(context);
  const asked = (await searchParams).month;
  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { timezone: true }, orderBy: { createdAt: "asc" } }),
  );
  const today = zonedDay(new Date(), store?.timezone || "UTC");
  const month =
    typeof asked === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const { planned, unplanned, timeZone } = await postCalendar(db, context, month);

  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  // Monday first.
  const lead = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = new Map<string, typeof planned>();
  for (const post of planned) {
    const day = zonedDay(post.plannedFor!, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), post]);
  }
  const time = new Intl.DateTimeFormat("en", { timeStyle: "short", timeZone });
  const title = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content calendar"
        description={
          <>
            Planned posts by day ({timeZone}).{" "}
            <Link href="/admin/marketing/posts" className="underline underline-offset-4">
              Posts
            </Link>
            {unplanned > 0 ? ` · ${unplanned} not planned yet` : ""}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/marketing/calendar?month=${shift(month, -1)}`}
          className={buttonClasses("secondary")}
        >
          Previous
        </Link>
        <h2 className="min-w-40 text-center text-lg font-semibold" data-testid="calendar-month">
          {title}
        </h2>
        <Link
          href={`/admin/marketing/calendar?month=${shift(month, 1)}`}
          className={buttonClasses("secondary")}
        >
          Next
        </Link>
        <Link href="/admin/marketing/posts/new" className={buttonClasses()}>
          New post
        </Link>
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Calendar">
        <div
          className="grid min-w-[42rem] grid-cols-7 gap-px rounded-card border border-line bg-line text-sm"
          data-testid="calendar"
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="bg-surface-muted px-2 py-1 font-medium">
              {day}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} className="min-h-24 bg-surface" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, "0")}`;
            const posts = byDay.get(day) ?? [];
            return (
              <div
                key={day}
                className={`flex min-h-24 flex-col gap-1 bg-surface p-1.5 ${day === today ? "ring-2 ring-brand ring-inset" : ""}`}
                data-testid={`calendar-day-${day}`}
              >
                <span className="text-xs text-ink-muted">{i + 1}</span>
                {posts.map((post) => (
                  <Link
                    key={post.id}
                    href={`/admin/marketing/posts/${post.id}`}
                    className="flex flex-col rounded-control border border-line p-1 text-xs hover:bg-surface-muted"
                  >
                    <span className="truncate font-medium">{post.title}</span>
                    <span className="text-ink-muted">
                      {time.format(post.plannedFor!)} · {CHANNEL_LABEL[post.channel]}
                    </span>
                    <span>
                      <Badge tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Badge>
                    </span>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
