import type { SetupChecklist } from "@ecom/core";
import { Alert, Card } from "@ecom/ui";
import Link from "next/link";

const DAY = 24 * 60 * 60 * 1000;

const ending = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "Asia/Beirut" });

/**
 * A new shop's first steps (D121), each ticked from the shop's own data, and
 * how long its free trial has left. Hidden once every step is done and the
 * shop is not on a trial.
 */
export function SetupGuide({
  checklist,
  welcome,
  now = new Date(),
}: {
  checklist: SetupChecklist;
  welcome: boolean;
  now?: Date;
}) {
  const { steps, done, plan, trialEndsAt } = checklist;
  const daysLeft =
    plan === "trial" && trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY))
      : null;
  if (done === steps.length && daysLeft === null && !welcome) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="setup-guide">
      {welcome ? (
        <Alert tone="success" testId="welcome">
          Welcome! Your shop is ready. Follow the steps below to get it ready to sell.
        </Alert>
      ) : null}
      {daysLeft !== null ? (
        <Alert tone={daysLeft <= 3 ? "warning" : "info"} testId="trial-banner">
          Free trial: {daysLeft} {daysLeft === 1 ? "day" : "days"} left (ends{" "}
          {ending.format(trialEndsAt!)}).
        </Alert>
      ) : null}
      {done < steps.length ? (
        <Card title="Get your shop ready" description={`${done} of ${steps.length} done`}>
          <div
            className="mb-4 h-2 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
          >
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${(done / steps.length) * 100}%` }}
            />
          </div>
          <ol className="flex flex-col divide-y divide-line">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-3 py-3" data-done={step.done}>
                <span
                  aria-hidden="true"
                  className={
                    step.done
                      ? "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success text-xs font-bold text-white"
                      : "mt-0.5 size-6 shrink-0 rounded-full border-2 border-line-strong"
                  }
                >
                  {step.done ? "✓" : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {step.done ? (
                    <span className="font-medium text-ink-muted line-through">
                      {step.title}
                      <span className="sr-only"> (done)</span>
                    </span>
                  ) : (
                    <Link href={step.href} className="font-medium underline underline-offset-4">
                      {step.title}
                    </Link>
                  )}
                  <span className="text-sm text-ink-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
