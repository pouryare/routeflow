"use client";

import { useCallback, useEffect, useRef } from "react";
import { carvedCardPath } from "@/lib/design/carve";

/** A card with a rounded rectangle subtracted from its top inline-start corner, with the
 *  faces of the people on the record living in the bay that removal opens up — the
 *  artifact's `.cradlewrap`.
 *
 *  The silhouette is a clip-path computed from the card's MEASURED size, because the
 *  notch keeps a fixed size while the card is fluid; a mask sized in percentages would
 *  stretch the corner radii, and the bay's rounded inner corner is the whole shape.
 *  drop-shadow (not box-shadow) is what follows a clipped edge.
 */
export default function CarvedCard({
  shoulder,
  avatars,
  children,
}: {
  shoulder?: React.ReactNode;
  avatars: React.ReactNode;
  children: React.ReactNode;
}) {
  const card = useRef<HTMLDivElement | null>(null);

  const carve = useCallback(() => {
    const el = card.current;
    if (!el) return;
    const d = carvedCardPath(el.offsetWidth, el.offsetHeight);
    el.style.clipPath = d ? `path("${d}")` : "";
    /* Toggled rather than always-on: below the minimum width the card is an ordinary
       rounded rectangle again, and `.carved` is what squares the radius so the clip-path
       is the only thing describing the shape. */
    el.classList.toggle("carved", Boolean(d));
  }, []);

  useEffect(() => {
    carve();
    const ro = new ResizeObserver(carve);
    const el = card.current;
    if (el) ro.observe(el);
    /* The card's height depends on the Persian glyphs inside it, so the box measured
       before the webfont lands is not the box it ends up with. */
    document.fonts?.ready.then(carve).catch(() => {});
    return () => ro.disconnect();
  }, [carve]);

  return (
    <div className="cradlewrap">
      {/* A SIBLING of the carved element, never a child: clip-path clips descendants, so
          avatars placed inside are erased by the bay that exists to hold them. */}
      <div className="cradle">{avatars}</div>
      <div className="cradlecard" ref={card}>
        {shoulder ? <div className="shoulder">{shoulder}</div> : null}
        <div className="cradlebody">{children}</div>
      </div>
    </div>
  );
}
