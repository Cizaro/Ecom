import type { ReactNode } from "react";
import { cx } from "./cx";

export type AlertTone = "error" | "success" | "warning" | "info";

const ALERT_TONES: Record<AlertTone, string> = {
  error: "bg-danger-soft text-danger-ink",
  success: "bg-success-soft text-success-ink",
  warning: "border border-warning-line bg-warning-soft text-warning-ink",
  info: "bg-info-soft text-info-ink",
};

/**
 * A message box. Errors are announced immediately (role="alert"); other
 * tones politely (role="status").
 */
export function Alert({
  tone,
  children,
  className,
  testId,
}: {
  tone: AlertTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      className={cx("rounded-control px-3 py-2 text-sm", ALERT_TONES[tone], className)}
    >
      {children}
    </p>
  );
}

export type BadgeTone = "neutral" | "success" | "warning";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-ink-muted",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface p-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-ink-muted">{children}</div> : null}
    </div>
  );
}
