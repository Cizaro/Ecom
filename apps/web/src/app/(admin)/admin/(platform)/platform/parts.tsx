import { formatMoney, type ShopStatus } from "@ecom/core";
import { Badge } from "@ecom/ui";
import type { ReactNode } from "react";

// Small building blocks shared by the platform panel's pages.

export const when = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "Asia/Beirut",
});
export const whenTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Beirut",
});

export const dollars = (micros: number) =>
  `$${(micros / 1_000_000).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const money = (rows: { currency: string; amount: number }[]) =>
  rows.length === 0 ? "$0.00" : rows.map((r) => formatMoney(r.amount, r.currency)).join(" · ");

/** One headline figure. */
export function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4"
      data-testid={testId}
    >
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: ShopStatus }) {
  return (
    <Badge tone={status === "active" ? "success" : "warning"}>
      {status === "active" ? "Active" : status === "suspended" ? "Suspended" : "Closed"}
    </Badge>
  );
}

/** Bars for a short daily series, with a text summary for screen readers. */
export function DailyBars({
  series,
  label,
}: {
  series: { day: string; orders: number }[];
  label: string;
}) {
  const max = Math.max(1, ...series.map((s) => s.orders));
  const total = series.reduce((sum, s) => sum + s.orders, 0);
  const W = 560;
  const H = 120;
  const slot = W / series.length;
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${total} in total over ${series.length} days.`}
      >
        {series.map((s, i) => {
          const h = (s.orders / max) * H;
          return (
            <g key={s.day}>
              <rect
                x={i * slot + slot * 0.15}
                y={H - h}
                width={slot * 0.7}
                height={Math.max(h, s.orders > 0 ? 2 : 0)}
                rx={3}
                className="fill-brand"
              />
              {i % 3 === 0 || i === series.length - 1 ? (
                <text
                  x={i * slot + slot / 2}
                  y={H + 14}
                  textAnchor="middle"
                  className="fill-ink-muted text-[10px]"
                >
                  {s.day.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** The shop's plan: a free trial with its days left, or set up by you. */
export function PlanBadge({
  plan,
  trialEndsAt,
  now = new Date(),
}: {
  plan: string | null;
  trialEndsAt: Date | null;
  now?: Date;
}) {
  if (plan === "trial" && trialEndsAt) {
    const days = Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return (
      <Badge tone={days <= 3 ? "warning" : "neutral"}>
        {days > 0 ? `Trial, ${days} ${days === 1 ? "day" : "days"} left` : "Trial ended"}
      </Badge>
    );
  }
  return <Badge tone="neutral">{plan ?? "Set up by you"}</Badge>;
}
