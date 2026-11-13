import type { OptionChoice } from "@ecom/core";
import { cx } from "@ecom/ui";
import Link from "next/link";

const CHIP =
  "flex min-h-11 min-w-11 items-center justify-center rounded-control border px-4 text-sm";

function Choices({
  legend,
  choices,
  hrefFor,
  unavailableNote,
}: {
  legend: string;
  choices: readonly OptionChoice[];
  hrefFor: (variantId: string) => string;
  unavailableNote: string;
}) {
  if (choices.length === 0) return null;
  const selected = choices.find((choice) => choice.selected);
  return (
    <div data-testid={`options-${legend.toLowerCase()}`}>
      <p className="text-sm">
        <span className="font-medium">{legend}:</span>{" "}
        <span className="text-ink-muted">{selected?.label ?? "—"}</span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label={legend}>
        {choices.map((choice) => (
          <li key={choice.value}>
            {choice.variantId ? (
              <Link
                href={hrefFor(choice.variantId)}
                // The choice changes what the same page shows: stay where the
                // shopper is and do not pile up history entries.
                scroll={false}
                replace
                aria-current={choice.selected ? "true" : undefined}
                className={cx(
                  CHIP,
                  choice.selected
                    ? "border-brand bg-brand text-brand-contrast"
                    : "border-line-strong hover:bg-surface-muted",
                )}
              >
                {choice.label}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={cx(
                  CHIP,
                  "border-dashed border-line-strong text-ink-subtle line-through",
                )}
              >
                {choice.label}
                <span className="sr-only"> ({unavailableNote})</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Colour and size choices. Each choice is a link to the same page with that
 * variant selected, so it works without JavaScript and the selection can be
 * shared or bookmarked.
 */
export function VariantPicker({
  colors,
  sizes,
  hrefFor,
  selectedColor,
}: {
  colors: readonly OptionChoice[];
  sizes: readonly OptionChoice[];
  hrefFor: (variantId: string) => string;
  selectedColor: string | null;
}) {
  if (colors.length <= 1 && sizes.length <= 1) return null;
  return (
    <div className="flex flex-col gap-4">
      {colors.length > 1 ? (
        <Choices legend="Colour" choices={colors} hrefFor={hrefFor} unavailableNote="" />
      ) : null}
      {sizes.length > 1 ? (
        <Choices
          legend="Size"
          choices={sizes}
          hrefFor={hrefFor}
          unavailableNote={
            selectedColor ? `not made in ${selectedColor}` : "not available with this choice"
          }
        />
      ) : null}
    </div>
  );
}
