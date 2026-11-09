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
    <div className="photoacc">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-label={p.caption ?? `عکس ${i + 1}`}
          aria-current={i === active ? "true" : undefined}
          className="photoacc__item"
          data-open={i === active}
          onClick={() => (i === active ? onView(p.id) : setOpen(i))}
        >
          <img src={`/api/photos/${p.id}/file?size=thumb`} alt={p.caption ?? ""} loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  );
}

/** A customer's or district's photos: an accordion when there are a few, a grid of squares when there are many. */
export default function PhotoThumbs({
  photos,
  onView,
  picked,
}: {
  photos: { id: number; caption: string | null }[];
  onView: (id: number) => void;
  /** Choosing photos to compare: always a grid (every photo one tap away), with the chosen ones ringed. */
  picked?: number[];
}) {
  if (!picked && photos.length >= 2 && photos.length <= ACCORDION_MAX) return <PhotoAccordion photos={photos} onView={onView} />;
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-label={p.caption ?? `عکس ${i + 1}`}
          onClick={() => onView(p.id)}
          aria-pressed={picked ? picked.includes(p.id) : undefined}
          className={`aspect-square overflow-hidden rounded-[var(--radius-sm)] border transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent ${picked?.includes(p.id) ? "border-accent ring-2 ring-accent" : "border-border"}`}
        >
          <img src={`/api/photos/${p.id}/file?size=thumb`} alt={p.caption ?? ""} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
