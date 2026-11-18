import { listConversations, SUPPORT_STATUSES } from "@ecom/core";
import { Badge, buttonClasses, EmptyState, Field, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABEL } from "./labels";
import { requirePermission, tenantDb } from "@/server/access";

export const metadata: Metadata = { title: "Inbox" };

const LABEL = { open: "To answer", waiting: "Waiting for customer", closed: "Closed" };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("inbox.read");
  const params = await searchParams;
  const status = SUPPORT_STATUSES.find((value) => value === first(params.status)) ?? "open";
  const mine = first(params.mine) === "1";
  const search = (first(params.q) ?? "").slice(0, 100);
  const result = await listConversations(tenantDb(context), context, { status, mine, search });
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  const link = (next: Record<string, string>) => {
    const query = new URLSearchParams({ status, ...(mine ? { mine: "1" } : {}), ...next });
    return `/admin/inbox?${query}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox"
        description="Messages from customers. Replies are emailed to them; notes stay between staff."
      />
      <nav aria-label="Inbox filters" className="flex flex-wrap gap-2 text-sm">
        {SUPPORT_STATUSES.map((value) => (
          <Link
            key={value}
            href={link({ status: value })}
            aria-current={status === value ? "page" : undefined}
            className={`rounded-control border px-3 py-1 ${status === value ? "border-ink font-medium" : "border-line"}`}
          >
            {LABEL[value]} ({result.counts[value]})
          </Link>
        ))}
        <Link
          href={mine ? `/admin/inbox?status=${status}` : link({ mine: "1" })}
          className={`rounded-control border px-3 py-1 ${mine ? "border-ink font-medium" : "border-line"}`}
        >
          Mine only
        </Link>
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={status} />
        {mine ? <input type="hidden" name="mine" value="1" /> : null}
        <div className="flex-1">
          <Field
            label="Search"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Email or subject"
          />
        </div>
        <button type="submit" className={buttonClasses("secondary")}>
          Search
        </button>
      </form>
      {result.items.length === 0 ? (
        <EmptyState title="No conversations here" />
      ) : (
        <List testId="inbox-list">
          {result.items.map((item) => (
            <ListItem key={item.id} testId="inbox-row">
              <div className="min-w-0">
                <Link
                  href={`/admin/inbox/${item.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.subject}
                </Link>
                <p className="truncate text-sm text-ink-muted">
                  {item.name} · {item.email}
                </p>
                {item.aiSummary ? (
                  <p className="truncate text-sm text-ink-muted" data-testid="inbox-ai-summary">
                    {item.aiSummary}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                {item.aiCategory && item.aiCategory in CATEGORY_LABEL ? (
                  <Badge
                    tone={
                      item.aiCategory === "question" ||
                      item.aiCategory === "order_status" ||
                      item.aiCategory === "other"
                        ? "neutral"
                        : "warning"
                    }
                  >
                    {CATEGORY_LABEL[item.aiCategory as keyof typeof CATEGORY_LABEL]}
                  </Badge>
                ) : null}
                {item.aiUrgency === "high" ? <Badge tone="warning">Urgent</Badge> : null}
                {item.assignedUserId === context.userId ? (
                  <Badge tone="success">Yours</Badge>
                ) : null}
                <span>{when.format(item.lastMessageAt)}</span>
              </div>
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
}
