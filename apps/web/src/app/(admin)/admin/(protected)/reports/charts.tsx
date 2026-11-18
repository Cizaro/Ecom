import type { AnalyticsReport } from "@ecom/core";

// Charts for the reports page, drawn as plain SVG on the server: no chart
// library, no script. Colours come from the theme tokens.

const W = 800;
const H = 230;
const PAD = { top: 14, right: 12, bottom: 28, left: 64 };

/** Daily sales for the period, then the next 14 days' forecast as a range. */
export function SalesChart({
  report,
  money,
}: {
  report: AnalyticsReport;
  money: (minor: number) => string;
}) {
  const actual = report.daily;
  const future = report.forecast.enough ? report.forecast.days : [];
  const count = actual.length + future.length;
  const max = Math.max(1, ...actual.map((d) => d.sales), ...future.map((d) => d.high));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / count;
  const barW = Math.max(1.5, slot * 0.7);
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelDays = [0, Math.floor((actual.length - 1) / 2), actual.length - 1];
  const fmtDay = (day: string) =>
    new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );

  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`Sales per day from ${report.from} to ${report.to}${future.length ? ", then the expected range for the next 14 days" : ""}.`}
          data-testid="reports-sales-chart"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-ink-muted text-[11px]"
              >
                {money(Math.round(t))}
              </text>
            </g>
          ))}
          {actual.map((d, i) => (
            <rect
              key={d.day}
              x={x(i)}
              y={y(d.sales)}
              width={barW}
              height={Math.max(0, y(0) - y(d.sales))}
              className="fill-brand"
            >
              <title>{`${d.day}: ${money(d.sales)}, ${d.orders} ${d.orders === 1 ? "order" : "orders"}`}</title>
            </rect>
          ))}
          {future.map((d, j) => {
            const i = actual.length + j;
            return (
              <g key={d.day}>
                <rect
                  x={x(i)}
                  y={y(d.high)}
                  width={barW}
                  height={Math.max(1, y(d.low) - y(d.high))}
                  className="fill-accent"
                  opacity={0.25}
                />
                <line
                  x1={x(i)}
                  x2={x(i) + barW}
                  y1={y(d.expected)}
                  y2={y(d.expected)}
                  className="stroke-accent"
                  strokeWidth={2}
                />
                <title>{`${d.day}: about ${money(d.expected)} (${money(d.low)} to ${money(d.high)})`}</title>
              </g>
            );
          })}
          {future.length ? (
            <line
              x1={PAD.left + actual.length * slot}
              x2={PAD.left + actual.length * slot}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="stroke-ink-subtle"
              strokeDasharray="4 4"
            />
          ) : null}
          {labelDays.map((i) =>
            actual[i] ? (
              <text
                key={i}
                x={x(i) + barW / 2}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === actual.length - 1 ? "end" : "middle"}
                className="fill-ink-muted text-[11px]"
              >
                {fmtDay(actual[i].day)}
              </text>
            ) : null,
          )}
          {future.length ? (
            <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-accent text-[11px]">
              next 14 days
            </text>
          ) : null}
        </svg>
      </div>
      <figcaption className="text-sm text-ink-muted">
        Bars are sales per day.{" "}
        {future.length
          ? "After the dashed line: the expected range for the next 14 days, from the same weekdays over the last 8 weeks."
          : "A forecast appears once there are at least 14 days with sales."}
      </figcaption>
    </figure>
  );
}

/** Product views → added to cart → checkout started → orders placed. */
export function Funnel({ funnel }: { funnel: AnalyticsReport["funnel"] }) {
  const steps = [
    { label: "Product views", value: funnel.views },
    { label: "Added to cart", value: funnel.addsToCart },
    { label: "Checkout started", value: funnel.checkouts },
    { label: "Orders placed", value: funnel.orders },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="flex flex-col gap-3" data-testid="reports-funnel">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1]!.value : null;
        const rate = prev && prev > 0 ? Math.round((step.value / prev) * 1000) / 10 : null;
        return (
          <li key={step.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{step.label}</span>
              <span className="tabular-nums">
                {step.value}
                {rate !== null ? (
                  <span className="text-ink-muted"> · {rate}% of the step before</span>
                ) : null}
              </span>
            </div>
            <div className="h-3 rounded-control bg-surface-muted" aria-hidden="true">
              <div
                className="h-3 rounded-control bg-brand"
                style={{
                  width: `${Math.max(step.value > 0 ? 1.5 : 0, (step.value / top) * 100)}%`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal bars, largest first. */
export function Bars({
  rows,
  format,
  testId,
}: {
  rows: { label: string; value: number; note?: string }[];
  format: (value: number) => string;
  testId?: string;
}) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {format(r.value)}
              {r.note ? <span className="text-ink-muted"> · {r.note}</span> : null}
            </span>
          </div>
          <div className="h-2 rounded-control bg-surface-muted" aria-hidden="true">
            <div
              className="h-2 rounded-control bg-accent"
              style={{ width: `${(r.value / top) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
