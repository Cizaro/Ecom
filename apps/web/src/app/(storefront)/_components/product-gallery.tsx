"use client";

import type { ImageView } from "@ecom/core";
import { useRef, useState, type MouseEvent } from "react";
import { MediaImage } from "@/components/media-image";

export interface GalleryPicture {
  id: string;
  alt: string;
  image: ImageView;
}

/**
 * Product pictures as a strip that snaps to one picture at a time. Swiping
 * (touch), a trackpad, or the arrow keys once the strip has focus all move
 * through it natively; the thumbnails jump straight to a picture.
 *
 * Without JavaScript the strip still scrolls and the thumbnails are ordinary
 * links to each picture.
 */
export function ProductGallery({ pictures }: { pictures: readonly GalleryPicture[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = pictures.length;

  function show(event: MouseEvent, index: number) {
    const element = strip.current;
    if (!element) return;
    event.preventDefault();
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ left: index * element.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setActive(index);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="gallery">
      <div
        ref={strip}
        // Focusable so the arrow keys can scroll it.
        tabIndex={count > 1 ? 0 : undefined}
        role="group"
        aria-roledescription="carousel"
        aria-label="Product pictures"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.clientWidth > 0) {
            setActive(Math.round(element.scrollLeft / element.clientWidth));
          }
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-card bg-surface-muted [scrollbar-width:none]"
      >
        {pictures.map((picture, index) => (
          <div
            key={picture.id}
            id={`picture-${index + 1}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
            className="aspect-[4/5] w-full shrink-0 snap-center"
            data-testid="gallery-slide"
          >
            <MediaImage
              image={picture.image}
              alt={picture.alt}
              sizes="(min-width: 768px) 50vw, 100vw"
              priority={index === 0}
              className="size-full"
            />
          </div>
        ))}
      </div>

      {count > 1 ? (
        <>
          <ul className="flex flex-wrap gap-2" aria-label="Choose a picture">
            {pictures.map((picture, index) => (
              <li key={picture.id}>
                <a
                  href={`#picture-${index + 1}`}
                  onClick={(event) => show(event, index)}
                  aria-label={`Show picture ${index + 1} of ${count}`}
                  aria-current={index === active ? "true" : undefined}
                  data-testid="gallery-thumbnail"
                  className="block size-16 overflow-hidden rounded-control border-2 border-transparent aria-[current=true]:border-brand"
                >
                  <MediaImage image={picture.image} alt="" sizes="64px" className="size-full" />
                </a>
              </li>
            ))}
          </ul>
          <p className="sr-only" role="status" data-testid="gallery-position">
            Picture {active + 1} of {count}
          </p>
        </>
      ) : null}
    </div>
  );
}
