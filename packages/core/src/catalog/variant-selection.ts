// Choosing a variant on the product page. A product's variants differ by
// colour and size; the shopper picks one value of each and the page shows
// that variant's price and pictures. This file is plain logic with no
// database access, so the same rules can be reused by the cart later.

export interface SelectableVariant {
  id: string;
  color: string | null;
  size: string | null;
}

export interface OptionChoice {
  /** Lowercase form, used in the page address. */
  value: string;
  /** As the store wrote it. */
  label: string;
  selected: boolean;
  /**
   * False when no variant has this value together with the other value
   * currently chosen (for example size L in a colour that stops at M).
   */
  available: boolean;
  /** The variant that choosing this value leads to; null when unavailable. */
  variantId: string | null;
}

export interface VariantSelection<V extends SelectableVariant> {
  variant: V;
  colors: OptionChoice[];
  sizes: OptionChoice[];
  /** True when the address asked for a colour or size this product does not have. */
  unknownRequest: boolean;
}

const key = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

function distinct<V extends SelectableVariant>(
  variants: readonly V[],
  pick: (variant: V) => string | null,
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const variant of variants) {
    const label = pick(variant)?.trim();
    if (label && !seen.has(key(label))) seen.set(key(label), label);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

/**
 * Works out which variant is selected and what each colour and size choice
 * would lead to. `variants` must not be empty and should be in display order:
 * the first one is the default.
 *
 * Colour takes priority. Asking for a colour and a size that do not exist
 * together selects that colour in its first size, rather than silently
 * switching colour.
 */
export function selectVariant<V extends SelectableVariant>(
  variants: readonly V[],
  wanted: { color?: string | null; size?: string | null } = {},
): VariantSelection<V> {
  if (variants.length === 0) throw new Error("selectVariant: no variants");
  const wantedColor = key(wanted.color);
  const wantedSize = key(wanted.size);

  const withColor = wantedColor
    ? variants.filter((variant) => key(variant.color) === wantedColor)
    : [];
  const pool = withColor.length > 0 ? withColor : variants;
  const withSize = wantedSize ? pool.filter((variant) => key(variant.size) === wantedSize) : [];
  const variant = withSize[0] ?? pool[0]!;

  const unknownRequest =
    (wantedColor !== "" && withColor.length === 0) || (wantedSize !== "" && withSize.length === 0);

  const selectedColor = key(variant.color);
  const selectedSize = key(variant.size);

  const colors = distinct(variants, (v) => v.color).map((option): OptionChoice => {
    const matching = variants.filter((v) => key(v.color) === option.value);
    // Keep the chosen size when this colour has it; otherwise its first size.
    const target = matching.find((v) => key(v.size) === selectedSize) ?? matching[0]!;
    return {
      ...option,
      selected: option.value === selectedColor,
      available: true,
      variantId: target.id,
    };
  });

  const sizes = distinct(variants, (v) => v.size).map((option): OptionChoice => {
    const target = variants.find(
      (v) => key(v.size) === option.value && key(v.color) === selectedColor,
    );
    return {
      ...option,
      selected: option.value === selectedSize,
      available: target !== undefined,
      variantId: target?.id ?? null,
    };
  });

  return { variant, colors, sizes, unknownRequest };
}
