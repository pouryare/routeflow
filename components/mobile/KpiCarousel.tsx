"use client";

import { useRef, useState, type ReactNode } from "react";

export interface CarouselCard {
  id: string;
  body: ReactNode;
  /** The accessible name of the card's button. */
  label: string;
}

/** A row of report cards you swipe through, 80 % wide so the next one peeks in. Scroll-snap does
 *  the physics; the dots only reflect where the row has settled. A tap on a card calls `onOpen`
 *  (to show its breakdown in a DrillSheet). */
export default function KpiCarousel({ cards, onOpen, ariaLabel }: { cards: CarouselCard[]; onOpen: (id: string) => void; ariaLabel: string }) {
  const row = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);

  function settle() {
    const el = row.current;
    if (!el || el.children.length === 0) return;
    const first = el.children[0] as HTMLElement;
    const step = first.offsetWidth + 10;
    // scrollLeft is negative in RTL in modern browsers; its magnitude is the distance travelled.
    setAt(Math.max(0, Math.min(cards.length - 1, Math.round(Math.abs(el.scrollLeft) / step))));
  }

  return (
    <div className="kpicarousel">
      <ul ref={row} className="kpicarousel__row" aria-label={ariaLabel} onScroll={settle}>
        {cards.map((c) => (
          <li key={c.id} className="kpicarousel__item">
            <button type="button" className="kpicarousel__card" aria-label={c.label} onClick={() => onOpen(c.id)}>
              {/* The card is its own picture: a number, its change chip (with an arrow icon) and a sparkline, so a further icon would only add noise. */}
              {c.body}
            </button>
          </li>
        ))}
      </ul>
      <div className="kpicarousel__dots" aria-hidden>
        {cards.map((c, i) => (
          <i key={c.id} className={i === at ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}
