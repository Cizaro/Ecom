import {
  listReviewsForModeration,
  REPORT_REASON_LABEL,
  REVIEW_STATUSES,
  type ReviewStatus,
} from "@ecom/core";
import { Badge, Card, EmptyState, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, TextAreaField } from "../../_components/form";
import { moderateReviewAction, replyToReviewAction } from "./actions";

export const metadata: Metadata = { title: "Reviews" };

const FILTERS = [
  { value: "pending", label: "Waiting" },
  { value: "reported", label: "Reported" },
  { value: "approved", label: "Shown" },
  { value: "hidden", label: "Hidden" },
  { value: "rejected", label: "Rejected" },
] as const;

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "Waiting",
  approved: "Shown",
  hidden: "Hidden",
  rejected: "Rejected",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("reviews.moderate");
  const params = await searchParams;
  const requested = first(params.status);
  const status =
    requested === "reported"
      ? "reported"
      : (REVIEW_STATUSES.find((value) => value === requested) ?? "pending");
  const result = await listReviewsForModeration(tenantDb(context), context, { status });
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reviews"
        description={`Reviews from customers who received the product. Only reviews you approve are shown. ${result.pending} waiting.`}
      />
      <nav aria-label="Review filters" className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={`/admin/reviews?status=${filter.value}`}
            aria-current={status === filter.value ? "page" : undefined}
            className={`rounded-control border px-3 py-1 ${
              status === filter.value ? "border-ink font-medium" : "border-line"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {result.items.length === 0 ? (
        <EmptyState title="No reviews here" />
      ) : (
        <List testId="moderation-list">
          {result.items.map((review) => (
            <ListItem key={review.id} testId="moderation-row">
              <div className="flex w-full flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/catalog/products/${review.productId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {review.productName}
                  </Link>
                  <span aria-label={`${review.rating} out of 5 stars`} className="text-warning-ink">
                    {"★".repeat(review.rating)}
                    <span className="text-line-strong">{"★".repeat(5 - review.rating)}</span>
                  </span>
                  <Badge tone={review.status === "approved" ? "success" : "neutral"}>
                    {STATUS_LABEL[review.status]}
                  </Badge>
                  {review.reportCount > 0 ? (
                    <Badge tone="warning">
                      Reported {review.reportCount}×:{" "}
                      {review.reportReasons.map((reason) => REPORT_REASON_LABEL[reason]).join(", ")}
                    </Badge>
                  ) : null}
                </div>
                {review.title ? <p className="font-medium">{review.title}</p> : null}
                <p className="whitespace-pre-line" data-testid="moderation-body">
                  {review.body}
                </p>
                <p className="text-ink-muted">
                  {review.authorName} · {when.format(review.createdAt)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["approved", "hidden", "rejected"] as const)
                    .filter((next) => next !== review.status)
                    .map((next) => (
                      <ActionForm
                        key={next}
                        action={moderateReviewAction}
                        submitLabel={
                          next === "approved" ? "Approve" : next === "hidden" ? "Hide" : "Reject"
                        }
                        submitTone={next === "approved" ? undefined : "secondary"}
                      >
                        <input type="hidden" name="id" value={review.id} />
                        <input type="hidden" name="status" value={next} />
                      </ActionForm>
                    ))}
                </div>
                <details>
                  <summary className="cursor-pointer underline underline-offset-4">
                    {review.reply ? "Edit the store's reply" : "Reply publicly"}
                  </summary>
                  <div className="mt-2">
                    <ActionForm
                      action={replyToReviewAction}
                      submitLabel="Save reply"
                      submitTone="secondary"
                    >
                      <input type="hidden" name="id" value={review.id} />
                      <TextAreaField
                        label="Reply"
                        name="reply"
                        rows={3}
                        maxLength={2000}
                        hint="Shown under the review on the product page. Leave empty to remove it."
                        defaultValue={review.reply ?? ""}
                      />
                    </ActionForm>
                  </div>
                </details>
              </div>
            </ListItem>
          ))}
        </List>
      )}
      {result.total > result.items.length ? (
        <Card title="More">
          <p className="text-sm text-ink-muted">
            Showing the newest {result.items.length} of {result.total}.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
