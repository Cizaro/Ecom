import type { SHOP_TEMPLATES } from "@ecom/core";

type Template = (typeof SHOP_TEMPLATES)[number];

const RADIUS = { sharp: "0", soft: "0.5rem", round: "1rem" } as const;
const FONT = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'Segoe UI', system-ui, sans-serif",
} as const;

/**
 * A small drawing of a shop in this template's colours, corners and font:
 * header, banner, and a row of products. Decorative: the template's name
 * and description sit next to it as text.
 */
export function TemplatePreview({ template, shopName }: { template: Template; shopName?: string }) {
  const { brandColor, accentColor, corners, font } = template.branding;
  const radius = RADIUS[corners];
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden border border-line bg-white text-[10px] shadow-sm"
      style={{ borderRadius: radius === "0" ? "0" : "0.75rem", fontFamily: FONT[font] }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: brandColor }}
      >
        <span className="font-semibold text-white">{shopName ?? template.name}</span>
        <span className="flex gap-1.5">
          <span className="h-1.5 w-6 rounded-full bg-white/60" />
          <span className="h-1.5 w-6 rounded-full bg-white/60" />
          <span className="h-1.5 w-4 rounded-full bg-white/60" />
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div
          className="flex flex-col justify-end gap-1 p-3"
          style={{
            borderRadius: radius,
            background: `linear-gradient(135deg, ${brandColor}22, ${accentColor}33)`,
            minHeight: "4.5rem",
          }}
        >
          <span className="h-2 w-24 rounded-full" style={{ background: brandColor }} />
          <span className="h-1.5 w-16 rounded-full bg-stone-400/60" />
          <span
            className="mt-1 h-4 w-14"
            style={{ background: brandColor, borderRadius: radius === "0" ? "0" : "0.25rem" }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <span
                className="aspect-square bg-stone-200"
                style={{ borderRadius: radius, opacity: 1 - i * 0.15 }}
              />
              <span className="h-1.5 w-10 rounded-full bg-stone-300" />
              <span className="h-1.5 w-6 rounded-full" style={{ background: accentColor }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
