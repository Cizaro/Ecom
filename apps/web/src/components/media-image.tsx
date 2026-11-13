import type { ImageView } from "@ecom/core";
import { cx } from "@ecom/ui";

/**
 * An uploaded image. A plain <img> on purpose: the worker has already made
 * the smaller versions and the storage service (or a CDN in front of it)
 * serves them, so nothing needs to pass through the app's image optimiser.
 * Width and height are always set, so the page does not jump while it loads.
 */
export function MediaImage({
  image,
  alt,
  sizes,
  className,
  priority = false,
}: {
  image: ImageView;
  /** Empty for a purely decorative image. */
  alt: string;
  /** How wide the image is shown, for choosing a version. For example "160px". */
  sizes: string;
  className?: string;
  /** For the first images on a page: load at once instead of when scrolled to. */
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the comment above
    <img
      src={image.thumbnailUrl}
      srcSet={image.srcSet || undefined}
      sizes={image.srcSet ? sizes : undefined}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cx("bg-surface-muted object-contain", className)}
    />
  );
}
