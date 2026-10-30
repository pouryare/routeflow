"use client";

import { fadeSides } from "@/lib/scrollFade";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** A sideways-scrolling row that darkens the edge(s) with more items beyond it, so a cut-off chip
 *  reads as «scroll for more». The fade appears only on a side that still has content and goes
 *  away at the end. Works in both directions (RTL scrollLeft counts from the right). */
export default function ScrollFade({ className = "", children }: { className?: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const { left, right } = fadeSides(el.scrollLeft, el.scrollWidth - el.clientWidth, el.matches(":dir(rtl)"));
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    measure();
    const el = row.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="scrollfade" data-more-left={more.left} data-more-right={more.right}>
      <div ref={row} className={className} onScroll={measure}>
        {children}
      </div>
      <span className="scrollfade__edge scrollfade__edge--left" aria-hidden="true" />
      <span className="scrollfade__edge scrollfade__edge--right" aria-hidden="true" />
    </div>
  );
}
