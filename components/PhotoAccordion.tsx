"use client";

import { useState } from "react";

/** A few shop photos side by side: the picked one opens wide while the others give way to thin strips.
 *  Tap a strip to open it; tap the open one to view it full size. For up to `ACCORDION_MAX` photos
 *  (a longer list stays a grid, where a strip would be too thin to recognise). */
const ACCORDION_MAX = 6;

function PhotoAccordion({
  photos,
  onView,
}: {
  photos: { id: number; caption: string | null }[];
  onView: (id: number) => void;
}) {
  const [open, setOpen] = useState(0);
  const active = Math.min(open, photos.length - 1);
  return (
    <div className="photoacc" role="list">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          role="listitem"
          aria-label={p.caption ?? `عکس ${i + 1}`}
          aria-current={i === active ? "true" : undefined}
          className="photoacc__item"
          data-open={i === active}
          onClick={() => (i === active ? onView(p.id) : setOpen(i))}
        >
          <picture>
            <source srcSet={`/api/photos/${p.id}/file?format=avif`} type="image/avif" />
            <img src={`/api/photos/${p.id}/file?format=webp`} alt={p.caption ?? ""} loading="lazy" decoding="async" />
          </picture>
        </button>
      ))}
    </div>
  );
}

/** A customer's or district's photos: an accordion when there are a few, a grid of squares when there are many. */
export default function PhotoThumbs({ photos, onView }: { photos: { id: number; caption: string | null }[]; onView: (id: number) => void }) {
  if (photos.length >= 2 && photos.length <= ACCORDION_MAX) return <PhotoAccordion photos={photos} onView={onView} />;
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {photos.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onView(p.id)}
          className="aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-border transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
        >
          <picture>
            <source srcSet={`/api/photos/${p.id}/file?format=avif`} type="image/avif" />
            <img src={`/api/photos/${p.id}/file?format=webp`} alt={p.caption ?? ""} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          </picture>
        </button>
      ))}
    </div>
  );
}
