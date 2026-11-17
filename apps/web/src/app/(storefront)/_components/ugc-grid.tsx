import type { PublicUgcItem } from "@ecom/core";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { ugcView } from "@/server/media";

/**
 * Photos and videos from customers and creators. Videos never play on their
 * own with sound: they start when tapped, muted until the viewer chooses.
 */
export function UgcGrid({
  items,
  showProduct = true,
}: {
  items: PublicUgcItem[];
  showProduct?: boolean;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="ugc-grid">
      {items.map((item) => {
        const view = ugcView(item.media);
        return (
          <li key={item.id} className="flex flex-col gap-1" data-testid="ugc-item">
            <div className="aspect-[4/5] overflow-hidden rounded-card bg-surface-muted">
              {view.kind === "video" ? (
                <video
                  src={view.url}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  width={view.image.width}
                  height={view.image.height}
                  className="h-full w-full object-cover"
                  aria-label={
                    item.caption ? `Video: ${item.caption}` : `Video by ${item.creditName}`
                  }
                  data-testid="ugc-video"
                />
              ) : (
                <MediaImage
                  image={view.image}
                  alt={item.caption ?? `Photo by ${item.creditName}`}
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <p className="text-xs text-ink-muted">
              <span className="font-medium text-ink">{item.creditName}</span>
              {item.caption ? ` · ${item.caption}` : ""}
            </p>
            {showProduct && item.product ? (
              <Link
                href={`/p/${item.product.slug}`}
                className="text-xs underline underline-offset-4"
              >
                {item.product.name}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
