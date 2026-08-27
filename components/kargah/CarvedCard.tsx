"use client";

import { useCallback, useEffect, useRef } from "react";
import { carvedCardPath } from "@/lib/design/carve";

/** A card with a rounded rectangle subtracted from its top inline-start corner, with the
 *  faces of the people on the record sitting in the bay (MASTER.md, "Carved bay card").
 *
 *  The path is computed from the card's MEASURED size rather than written in percentages,
 *  because a percentage path stretches the corner radii as the card grows -- the bay's
 *  rounded inner corner is the whole point of the shape, and it is the first thing a
 *  percentage loses.
 */
export default function CarvedCard({
  shoulder,
  avatars,
  children,
  className,
}: {
  /** The strip beside the bay: a title, a status pill. */
  shoulder?: React.ReactNode;
  avatars: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const card = useRef<HTMLDivElement | null>(null);

  const carve = useCallback(() => {
    const el = card.current;
    if (!el) return;
    const d = carvedCardPath(el.offsetWidth, el.offsetHeight);
    el.style.clipPath = d ? `path("${d}")` : "";
    /* Toggled rather than always-on: below the minimum width the card is an ordinary
       rounded rectangle again, and `.carved` is what swaps drop-shadow back to
       box-shadow and lets the avatars fall back above the card. */
    el.classList.toggle("carved", Boolean(d));
  }, []);

  useEffect(() => {
    carve();
    const ro = new ResizeObserver(carve);
    const el = card.current;
    if (el) ro.observe(el);
    /* The card's height depends on the Persian glyphs inside it, so the box measured
       before the webfont lands is not the box the card ends up with. */
    document.fonts?.ready.then(carve).catch(() => {});
    return () => ro.disconnect();
  }, [carve]);

  return (
    <div className={`cradlewrap${className ? ` ${className}` : ""}`}>
      {/* A SIBLING of the carved element, never a child: clip-path clips descendants,
          so avatars placed inside are erased by the bay that exists to hold them. */}
      <div className="cradle">{avatars}</div>
      <div className="cradlecard" ref={card}>
        {shoulder ? <div className="shoulder">{shoulder}</div> : null}
        <div className="cradlebody">{children}</div>
      </div>
    </div>
  );
}
