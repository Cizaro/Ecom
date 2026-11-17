import {
  REPORT_REASON_LABEL,
  REPORT_REASONS,
  type PublicReview,
  type RatingSummary,
  type ReviewEligibility,
} from "@ecom/core";
import Link from "next/link";
import { reportReviewAction, submitReviewAction } from "../reviews/actions";
import { AccountField, AccountForm, AccountSelect, AccountTextArea } from "./account-form";
import { shopT } from "@/server/i18n";

/** Five stars as text, read out as "4 out of 5 stars". */
export async function Stars({ rating }: { rating: number }) {
  const t = await shopT();
  const full = Math.round(rating);
  return (
    <span
      role="img"
      aria-label={t("{rating} out of 5 stars", { rating })}
      className="text-warning-ink"
    >
      {"★".repeat(full)}
      <span className="text-line-strong">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/** Next to the product name: the average and how many reviews, linking to them. */
export async function RatingLine({ summary }: { summary: RatingSummary }) {
  if (summary.count === 0 || summary.average === null) return null;
  const t = await shopT();
  return (
    <a href="#reviews" className="flex items-center gap-2 text-sm" data-testid="rating-line">
      <Stars rating={summary.average} />
      <span>
        {summary.average.toFixed(1)} ({t("{count} reviews", { count: summary.count })})
      </span>
    </a>
  );
}

export async function ProductReviews({
  productId,
  slug,
  summary,
  reviews,
  page,
  pageCount,
  eligibility,
  signedIn,
}: {
  productId: string;
  slug: string;
  summary: RatingSummary;
  reviews: PublicReview[];
  page: number;
  pageCount: number;
  eligibility: ReviewEligibility;
  signedIn: boolean;
}) {
  const t = await shopT();
  const when = new Intl.DateTimeFormat(t.intl, { dateStyle: "medium" });
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-title"
      className="flex flex-col gap-5"
      data-testid="reviews"
    >
      <h2 id="reviews-title" className="text-xl font-semibold">
        {t("Reviews")}
      </h2>

      {summary.count > 0 && summary.average !== null ? (
        <div
          className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-10"
          data-testid="review-summary"
        >
          <div>
            <p className="text-3xl font-semibold">{summary.average.toFixed(1)}</p>
            <Stars rating={summary.average} />
            <p className="text-sm text-ink-muted">
              {t("{count} reviews from customers who bought it", { count: summary.count })}
            </p>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {([5, 4, 3, 2, 1] as const).map((stars) => (
              <li key={stars} className="flex items-center gap-2">
                <span className="w-14">{t("{count} stars", { count: stars })}</span>
                <span className="h-2 w-40 overflow-hidden rounded bg-surface-muted" aria-hidden>
                  <span
                    className="block h-full bg-warning-ink"
                    style={{
                      width: `${Math.round((summary.stars[stars] / summary.count) * 100)}%`,
                    }}
                  />
                </span>
                <span className="text-ink-muted">{summary.stars[stars]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="no-reviews">
          {t("No reviews yet. Reviews come from customers who bought this product.")}
        </p>
      )}

      {reviews.length > 0 ? (
        <ul
          className="flex flex-col divide-y divide-line border-y border-line"
          data-testid="review-list"
        >
          {reviews.map((review) => (
            <li key={review.id} className="flex flex-col gap-2 py-4" data-testid="review">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Stars rating={review.rating} />
                {review.title ? <span className="font-medium">{review.title}</span> : null}
              </div>
              <p className="whitespace-pre-line text-sm">{review.body}</p>
              <p className="text-xs text-ink-muted">
                {review.authorName} · {t("Verified purchase")} · {when.format(review.createdAt)}
              </p>
              {review.reply ? (
                <div
                  className="rounded-control bg-surface-muted p-3 text-sm"
                  data-testid="review-reply"
                >
                  <p className="font-medium">{t("Reply from the store")}</p>
                  <p className="whitespace-pre-line text-ink-muted">{review.reply}</p>
                </div>
              ) : null}
              {signedIn ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-ink-muted underline underline-offset-4">
                    {t("Report this review")}
                  </summary>
                  <div className="mt-2 max-w-sm">
                    <AccountForm
                      action={reportReviewAction}
                      submitLabel={t("Send report")}
                      submitTone="secondary"
                    >
                      <input type="hidden" name="reviewId" value={review.id} />
                      <AccountSelect
                        label={t("Why?")}
                        name="reason"
                        id={`reason-${review.id}`}
                        defaultValue="spam"
                        options={REPORT_REASONS.map((value) => ({
                          value,
                          label: t(REPORT_REASON_LABEL[value]),
                        }))}
                      />
                    </AccountForm>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {pageCount > 1 ? (
        <nav aria-label={t("Review pages")} className="flex gap-3 text-sm">
          {page > 1 ? (
            <Link
              href={`/p/${slug}?reviews=${page - 1}#reviews`}
              className="underline underline-offset-4"
            >
              {t("Newer reviews")}
            </Link>
          ) : null}
          {page < pageCount ? (
            <Link
              href={`/p/${slug}?reviews=${page + 1}#reviews`}
              className="underline underline-offset-4"
            >
              {t("Older reviews")}
            </Link>
          ) : null}
        </nav>
      ) : null}

      <div className="max-w-xl" data-testid="review-write">
        {eligibility.state === "signed_out" ? (
          <p className="text-sm text-ink-muted">
            {t("Bought this?")}{" "}
            <Link
              href={`/account/sign-in?next=${encodeURIComponent(`/p/${slug}#reviews`)}`}
              className="text-ink underline underline-offset-4"
            >
              {t("Sign in to review it.")}
            </Link>
          </p>
        ) : eligibility.state === "not_bought" ? (
          <p className="text-sm text-ink-muted">
            {t("You can review this product once you have received it from an order.")}
          </p>
        ) : eligibility.state === "reviewed" ? (
          <p className="text-sm text-ink-muted" data-testid="review-status">
            {eligibility.status === "pending"
              ? t("Thank you for your review. It will appear once the store has checked it.")
              : eligibility.status === "approved"
                ? t("Thank you for reviewing this product.")
                : t("Thank you for your review.")}
          </p>
        ) : (
          <AccountForm
            action={submitReviewAction}
            submitLabel={t("Send review")}
            testId="review-form"
          >
            <h3 className="font-medium">{t("Write a review")}</h3>
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="slug" value={slug} />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t("Your rating")}</legend>
              <div className="flex flex-wrap gap-3">
                {[5, 4, 3, 2, 1].map((stars) => (
                  <label key={stars} className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name="rating"
                      value={stars}
                      className="size-5 accent-brand"
                    />
                    {t("{count} stars", { count: stars })}
                  </label>
                ))}
              </div>
            </fieldset>
            <AccountField label={t("Title")} name="title" maxLength={120} hint={t("Optional")} />
            <AccountTextArea
              label={t("Your review")}
              name="body"
              rows={4}
              maxLength={2000}
              hint={t("What did you like or not? 10 characters at least.")}
            />
          </AccountForm>
        )}
      </div>
    </section>
  );
}
