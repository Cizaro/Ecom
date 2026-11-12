import type { ReactNode } from "react";
import { cx } from "./cx";

/** Page title, optional description and actions. One h1 per page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <div className="mt-1 text-ink-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** A bordered panel. Give it a heading for screen-reader landmarks. */
export function Card({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = title ? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        "flex flex-col gap-4 rounded-card border border-line bg-surface p-5",
        className,
      )}
    >
      {title ? (
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <div className="mt-1 text-sm text-ink-muted">{description}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A list with dividers inside a card-like border. */
export function List({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <ul
      data-testid={testId}
      className="divide-y divide-line rounded-card border border-line bg-surface"
    >
      {children}
    </ul>
  );
}

export function ListItem({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <li
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
    >
      {children}
    </li>
  );
}
