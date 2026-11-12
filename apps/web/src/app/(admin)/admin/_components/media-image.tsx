import type { ImageView } from "@ecom/core";
import { cx } from "@ecom/ui";

/**
 * An uploaded image. A plain <img> on purpose: the worker has already made
 * the smaller versions and the storage service (or a CDN in front of it)
 * serves them, so nothing needs to pass through the app's image optimiser.
 */
export function MediaImage({
  image,
  alt,
  sizes,
  className,
}: {
  image: ImageView;
  /** Empty for a purely decorative image. */
  alt: string;
  /** How wide the image is shown, for choosing a version. For example "160px". */
  sizes: string;
  className?: string;
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
      loading="lazy"
      decoding="async"
      className={cx("bg-surface-muted object-contain", className)}
    />
  );
}
