import { CAMPAIGN_STATUSES, formatMoney, listCampaigns, type CampaignSummary } from "@ecom/core";
import { Badge, buttonClasses, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import {
  CAMPAIGN_CHANNEL_LABEL,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  OBJECTIVE_LABEL,
} from "../labels";

export const metadata: Metadata = { title: "Marketing plan" };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const day = (value: string) => shortDate.format(new Date(`${value}T00:00:00Z`));

// The marketing plan: the year's campaigns by the month they start, each with
// its dates, goal, channels and what it has brought so far.
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("marketing.write");
  const params = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const asked = Number(first(params.year));
  const year = Number.isInteger(asked) && asked > 2000 && asked < 3000 ? asked : thisYear;
  const status = CAMPAIGN_STATUSES.find((s) => s === first(params.status));
  const campaigns = await listCampaigns(tenantDb(context), context, { year, status });

  const byMonth = new Map<number, CampaignSummary[]>();
  for (const campaign of campaigns) {
    const start = new Date(`${campaign.startsOn}T00:00:00Z`);
    const month = start.getUTCFullYear() < year ? 0 : start.getUTCMonth();
    byMonth.set(month, [...(byMonth.get(month) ?? []), campaign]);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marketing plan"
        description={
          <>
            Campaigns by month: the brief, dates, channels and results counted from your shop.{" "}
            <Link href="/admin/marketing/segments" className="underline underline-offset-4">
              Segments
            </Link>
            {" · "}
            <Link href="/admin/marketing/links" className="underline underline-offset-4">
              Tracking links
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/marketing/campaigns?year=${year - 1}`}
          className={buttonClasses("secondary")}
        >
          {year - 1}
        </Link>
        <h2 className="min-w-16 text-center text-lg font-semibold" data-testid="plan-year">
          {year}
        </h2>
        <Link
          href={`/admin/marketing/campaigns?year=${year + 1}`}
          className={buttonClasses("secondary")}
        >
          {year + 1}
        </Link>
        <Link href="/admin/marketing/campaigns/new" className={buttonClasses()}>
          New campaign
        </Link>
      </div>
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Filter by status">
        <Link
          href={`/admin/marketing/campaigns?year=${year}`}
          className={status ? "underline underline-offset-4" : "font-semibold"}
        >
          All
        </Link>
        {CAMPAIGN_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/marketing/campaigns?year=${year}&status=${s}`}
            className={status === s ? "font-semibold" : "underline underline-offset-4"}
          >
            {CAMPAIGN_STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>

      {campaigns.length === 0 ? (
        <EmptyState title={`No campaigns in ${year}`} />
      ) : (
        <div className="flex flex-col gap-6" data-testid="plan">
          {[...byMonth.entries()]
            .sort(([a], [b]) => a - b)
            .map(([month, items]) => (
              <section key={month} className="flex flex-col gap-2">
                <h3 className="text-base font-semibold">
                  {monthName.format(new Date(Date.UTC(year, month, 1)))}
                </h3>
                <ul className="flex flex-col gap-2">
                  {items.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-col gap-1 rounded-card border border-line p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                      data-testid="campaign-row"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          href={`/admin/marketing/campaigns/${c.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="text-ink-muted">
                          {day(c.startsOn)}
                          {c.endsOn ? ` to ${day(c.endsOn)}` : ""} · {OBJECTIVE_LABEL[c.objective]}
                          {c.channels.length
                            ? ` · ${c.channels.map((ch) => CAMPAIGN_CHANNEL_LABEL[ch]).join(", ")}`
                            : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>
                          {CAMPAIGN_STATUS_LABEL[c.status]}
                        </Badge>
                        <span className="text-ink-muted">
                          {c.postCount} {c.postCount === 1 ? "post" : "posts"} · {c.clicks}{" "}
                          {c.clicks === 1 ? "click" : "clicks"}
                          {c.budgetAmount !== null
                            ? ` · budget ${formatMoney(c.budgetAmount, c.currency)}`
                            : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
