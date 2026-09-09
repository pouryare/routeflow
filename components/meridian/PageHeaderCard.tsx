"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { carvedCardPath } from "@/lib/design/carve";
import type { AppTab } from "@/lib/appNav";

/** The card every shell page opens with: what this screen is, in a couple of lines, with
 *  the section's sibling tabs sitting in a bay cut out of its top edge.
 *
 *  The bay is the same device as CarvedCard's — a rounded rectangle subtracted from the
 *  top inline-start corner, clip-path from a measured box because a percentage mask
 *  stretches the corner radii as the card grows. What differs is what fills it: avatars
 *  are a fixed 52px each, so CarvedCard can assume a 272px bay, but a row of Persian tab
 *  labels is whatever width it is. So the ROW is measured and the bay is cut to fit it,
 *  which is also why the tabs render before the carve runs.
 *
 *  Why the tabs live here at all: the nav pill in the header opens a group's tabs on
 *  hover, and hover is not available to a touch or keyboard reader. Putting the active
 *  group's siblings inline on the page means moving between neighbours never depends on
 *  a pointer. See the design spec, decision #7.
 */
const NOTCH_HEIGHT = 56;
/** Breathing room either side of the tab row inside the bay. */
const NOTCH_PAD = 34;
/** Below this the bay stops reading as a step and the card is a plain rectangle, with
 *  the tabs above the title instead. Matches carvedCardPath's own floor. */
const MIN_CARVE_WIDTH = 360;

export default function PageHeaderCard({
  title,
  overview,
  tabs = [],
  currentHref,
}: {
  title: string;
  overview: string;
  tabs?: AppTab[];
  currentHref?: string;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  const row = useRef<HTMLDivElement | null>(null);

  const carve = useCallback(() => {
    const el = card.current;
    if (!el) return;
    const rowW = row.current?.offsetWidth ?? 0;
    const d =
      rowW > 0
        ? carvedCardPath(el.offsetWidth, el.offsetHeight, {
            notchWidth: rowW + NOTCH_PAD,
            notchHeight: NOTCH_HEIGHT,
            minWidth: MIN_CARVE_WIDTH,
          })
        : null;
    el.style.clipPath = d ? `path("${d}")` : "";
    /* `.carved` squares the radius so the clip-path is the only thing describing the
       shape; without the toggle a narrow card keeps a rounded rectangle. */
    el.classList.toggle("carved", Boolean(d));
    el.classList.toggle("phc--flat", !d);
  }, []);

  useEffect(() => {
    carve();
    const ro = new ResizeObserver(carve);
    if (card.current) ro.observe(card.current);
    if (row.current) ro.observe(row.current);
    /* Persian glyph widths change when the webfont lands, so the row measured before it
       arrives is not the row that ends up on screen. */
    document.fonts?.ready.then(carve).catch(() => {});
    return () => ro.disconnect();
  }, [carve]);

  return (
    <div className="phcwrap">
      {/* A SIBLING of the carved element, never a child: clip-path clips descendants, so
          tabs placed inside are erased by the very bay that exists to hold them. */}
      {tabs.length > 0 && (
        <nav className="phc__tabs" ref={row} aria-label={`بخش‌های ${title}`}>
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.href === currentHref ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="phc" ref={card}>
        <div className="phc__body">
          <h1 className="phc__title">{title}</h1>
          {overview ? <p className="phc__overview">{overview}</p> : null}
        </div>
      </div>
    </div>
  );
}
