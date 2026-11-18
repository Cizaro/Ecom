import { formatMoney, type Observation } from "@ecom/core";
import { Badge } from "@ecom/ui";
import Link from "next/link";
import { ActionForm } from "../../_components/form";
import { deleteObservationAction } from "./actions";
import { KIND_LABEL } from "./labels";

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** Observations with the source and, for prices, ours next to theirs. */
export function ObservationList({
  observations,
  showCompetitor = false,
  canDelete = false,
}: {
  observations: Observation[];
  showCompetitor?: boolean;
  canDelete?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2" data-testid="observations">
      {observations.map((o) => {
        const theirs =
          o.priceAmount !== null && o.currency ? formatMoney(o.priceAmount, o.currency) : null;
        const ours =
          o.ours && o.ours.priceAmount !== null && o.ours.currency
            ? formatMoney(o.ours.priceAmount, o.ours.currency)
            : null;
        const difference =
          o.priceAmount !== null && o.ours?.priceAmount != null && o.currency === o.ours.currency
            ? o.ours.priceAmount - o.priceAmount
            : null;
        return (
          <li
            key={o.id}
            className="flex flex-col gap-1 rounded-card border border-line p-3 text-sm"
            data-testid="observation"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{KIND_LABEL[o.kind]}</Badge>
              <span className="font-medium">{o.title}</span>
            </div>
            <span className="text-xs text-ink-muted">
              Seen {date.format(new Date(`${o.observedOn}T00:00:00Z`))}
              {showCompetitor ? (
                <>
                  {" at "}
                  <Link
                    href={`/admin/research/${o.competitor.id}`}
                    className="underline underline-offset-4"
                  >
                    {o.competitor.name}
                  </Link>
                </>
              ) : null}
              {o.sourceUrl ? (
                <>
                  {" · "}
                  <a
                    href={o.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline underline-offset-4"
                  >
                    source
                  </a>
                </>
              ) : null}
            </span>
            {o.detail ? <p className="whitespace-pre-line">{o.detail}</p> : null}
            {theirs ? (
              <p data-testid="price-comparison">
                Their price <strong>{theirs}</strong>
                {o.ours ? (
                  <>
                    {" · our "}
                    <Link
                      href={`/admin/catalog/products/${o.ours.id}`}
                      className="underline underline-offset-4"
                    >
                      {o.ours.name}
                    </Link>{" "}
                    <strong>{ours ?? "not for sale"}</strong>
                    {difference !== null && difference !== 0 && o.currency
                      ? ` (ours is ${formatMoney(Math.abs(difference), o.currency)} ${difference > 0 ? "more" : "less"})`
                      : difference === 0
                        ? " (the same)"
                        : ""}
                  </>
                ) : null}
              </p>
            ) : null}
            {canDelete ? (
              <ActionForm action={deleteObservationAction} submitLabel="Delete" submitTone="danger">
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="competitorId" value={o.competitor.id} />
              </ActionForm>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
