"use client";

import { autoscrollSpeed, fadeSides } from "@/lib/scrollFade";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** A sideways-scrolling row that darkens the edge(s) with more items beyond it, so a cut-off chip
 *  reads as «scroll for more». The fade appears only on a side that still has content and goes
 *  away at the end. Works in both directions (RTL scrollLeft counts from the right). */
export default function ScrollFade({ className = "", role, "aria-label": ariaLabel, children }: { className?: string; role?: string; "aria-label"?: string; children: ReactNode }) {
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

  /* Mouse users: drag the row, roll the wheel, or press the middle button and move (autoscroll). A touch
     scrolls natively. A drag that moved more than a few pixels swallows the click that ends it. */
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let startX = 0, startLeft = 0, dragging = false, moved = false;
    let auto: { x: number; cur: number; raf: number } | null = null;

    const stopAuto = () => {
      if (auto) cancelAnimationFrame(auto.raf);
      auto = null;
      el.classList.remove("is-autoscroll");
    };
    const tick = () => {
      if (!auto) return;
      el.scrollLeft += autoscrollSpeed(auto.cur - auto.x);
      auto.raf = requestAnimationFrame(tick);
    };
    const down = (e: PointerEvent) => {
      if (auto) { stopAuto(); return; }
      if (e.pointerType !== "mouse") return;
      if (e.button === 1) {
        e.preventDefault();
        auto = { x: e.clientX, cur: e.clientX, raf: requestAnimationFrame(tick) };
        el.classList.add("is-autoscroll");
        return;
      }
      if (e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
      dragging = true; moved = false; startX = e.clientX; startLeft = el.scrollLeft;
    };
    const move = (e: PointerEvent) => {
      if (auto) { auto.cur = e.clientX; return; }
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 5) { moved = true; el.classList.add("is-dragging"); }
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const up = () => {
      dragging = false;
      el.classList.remove("is-dragging");
    };
    const click = (e: MouseEvent) => {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    };
    const wheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    const nodrag = (e: Event) => { if (dragging) e.preventDefault(); };
    el.addEventListener("dragstart", nodrag);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") stopAuto(); };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("click", click, true);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      stopAuto();
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("dragstart", nodrag);
      window.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <div className="scrollfade" data-more-left={more.left} data-more-right={more.right}>
      <div ref={row} className={className} role={role} aria-label={ariaLabel} onScroll={measure}>
        {children}
      </div>
      <span className="scrollfade__edge scrollfade__edge--left" aria-hidden="true" />
      <span className="scrollfade__edge scrollfade__edge--right" aria-hidden="true" />
    </div>
  );
}
