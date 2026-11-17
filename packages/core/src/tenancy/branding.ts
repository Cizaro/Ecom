// A store's look: the few values that make one storefront differ from
// another. The storefront is one template; components use named design
// tokens (bg-brand, text-accent, rounded-card, ...), and each store supplies
// its own values for them. Pure functions: no database, usable anywhere.

export const CORNER_STYLES = ["sharp", "soft", "round"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];

export const FONT_STYLES = ["sans", "serif", "rounded"] as const;
export type FontStyle = (typeof FONT_STYLES)[number];

export interface StoreBranding {
  /** Buttons and highlights, as #rrggbb. */
  brandColor: string;
  /** Sale prices and small accents, as #rrggbb. Must be readable on white. */
  accentColor: string;
  corners: CornerStyle;
  font: FontStyle;
  /** A short line under the store name in the footer. */
  tagline: string;
  contactEmail: string;
  contactPhone: string;
}

export const DEFAULT_BRANDING: StoreBranding = {
  brandColor: "#1c1917",
  accentColor: "#b45309",
  corners: "soft",
  font: "sans",
  tagline: "",
  contactEmail: "",
  contactPhone: "",
};

const HEX = /^#[0-9a-f]{6}$/;

/** "#ABC" or "abcdef" -> "#aabbcc"; null when it is not a colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  return HEX.test(hex) ? hex : null;
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Relative luminance (WCAG): 0 is black, 1 is white. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours (WCAG): 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const INK = "#1c1917";
const WHITE = "#ffffff";

/**
 * Text colour that reads well on this background: white or the usual dark
 * ink when either meets the accessibility standard (4.5 to 1), otherwise
 * whichever of white and pure black contrasts most (always at least 4.5).
 */
export function readableOn(background: string): string {
  const white = contrastRatio(background, WHITE);
  const ink = contrastRatio(background, INK);
  if (white >= 4.5 && white >= ink) return WHITE;
  if (ink >= 4.5) return INK;
  return white >= contrastRatio(background, "#000000") ? WHITE : "#000000";
}

/** The colour moved toward white (amount > 0) or black (amount < 0), for hover states. */
export function shade(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const weight = Math.min(Math.abs(amount), 1);
  return `#${channels(hex)
    .map((value) =>
      Math.round(value + (target - value) * weight)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Reads stored branding, falling back to the default for anything missing or odd. */
export function parseBranding(value: unknown): StoreBranding {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof raw[key] === "string" ? (raw[key] as string).slice(0, max) : "";
  return {
    brandColor: normalizeHex(raw.brandColor) ?? DEFAULT_BRANDING.brandColor,
    accentColor: normalizeHex(raw.accentColor) ?? DEFAULT_BRANDING.accentColor,
    corners: CORNER_STYLES.find((style) => style === raw.corners) ?? DEFAULT_BRANDING.corners,
    font: FONT_STYLES.find((style) => style === raw.font) ?? DEFAULT_BRANDING.font,
    tagline: text("tagline", 160),
    contactEmail: text("contactEmail", 254),
    contactPhone: text("contactPhone", 40),
  };
}

// System fonts only: nothing is downloaded from another site, so pages stay
// fast and private.
// Each stack ends with fonts that have Arabic letters, for the Arabic shop.
const FONTS: Record<FontStyle, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Arabic", Tahoma, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, "Noto Naskh Arabic", serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, "Noto Sans Arabic", Tahoma, sans-serif',
};

const CORNERS: Record<CornerStyle, { control: string; card: string }> = {
  sharp: { control: "0", card: "0" },
  soft: { control: "0.375rem", card: "0.75rem" },
  round: { control: "0.75rem", card: "1.25rem" },
};

/**
 * The design tokens for a store, as CSS custom properties to set on the
 * storefront's outer element. Button text is chosen to be readable on the
 * brand colour, whatever colour the store picks.
 */
export function themeVariables(branding: StoreBranding): Record<string, string> {
  const brand = branding.brandColor;
  const dark = luminance(brand) < 0.4;
  return {
    "--color-brand": brand,
    "--color-brand-hover": shade(brand, dark ? 0.18 : -0.12),
    "--color-brand-contrast": readableOn(brand),
    "--color-accent": branding.accentColor,
    // The focus ring must be visible on white: fall back to ink for pale brands.
    "--color-focus": contrastRatio(brand, WHITE) >= 3 ? brand : INK,
    "--radius-control": CORNERS[branding.corners].control,
    "--radius-card": CORNERS[branding.corners].card,
    "--font-sans": FONTS[branding.font],
  };
}

/** Ready-made looks staff can start from. */
export const BRANDING_PRESETS: { key: string; label: string; branding: Partial<StoreBranding> }[] =
  [
    {
      key: "classic",
      label: "Classic (dark and gold)",
      branding: { brandColor: "#1c1917", accentColor: "#b45309", corners: "soft", font: "sans" },
    },
    {
      key: "boutique",
      label: "Boutique (plum, serif)",
      branding: { brandColor: "#6b214f", accentColor: "#9d174d", corners: "sharp", font: "serif" },
    },
    {
      key: "fresh",
      label: "Fresh (green, rounded)",
      branding: {
        brandColor: "#166534",
        accentColor: "#0f766e",
        corners: "round",
        font: "rounded",
      },
    },
    {
      key: "ocean",
      label: "Ocean (navy and blue)",
      branding: { brandColor: "#1e3a8a", accentColor: "#1d4ed8", corners: "soft", font: "sans" },
    },
  ];
