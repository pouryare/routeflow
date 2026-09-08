"use client";

import { useCallback, useEffect, useRef } from "react";
import { notchedCardPath, type NotchEdge, type NotchSide } from "@/lib/design/notch";
import { cn } from "@/lib/cn";

/** A card with a rounded rectangle subtracted from one corner, with content (an icon,
 *  an avatar cluster, sub-navigation) seated in the bay that removal opens -- the app's
 *  core visual identity. Generalizes the previous CarvedCard: side, edge and notch size
 *  are all props instead of one hardcoded shape.
 *
 *  THE BORDER PROBLEM: clip-path removes box-shadow AND border from a clipped element.
 *  This card solves both with a stacked ::before technique -- an absolutely-positioned
 *  sibling layer carrying the SAME clip-path, coloured as the border, inset by 1px on a
 *  second nested clip so only a 1px ring shows. See the `data-notch-clip` element and its
 *  adjacent `.notch-edge` sibling below.
 *
 *  THE SHADOW PROBLEM: solved the same way CarvedCard solved it -- `filter: var(--card-drop)`
 *  (stacked drop-shadow, which DOES follow a clipped outline) on the OUTER wrapper, never
 *  box-shadow on the clipped element itself.
 *
 *  Avatars/shoulder content are SIBLINGS of the clipped element, never descendants --
 *  clip-path clips descendants too, so content placed inside would be erased by the very
 *  notch meant to hold it.
 */
export default function NotchedCard({
  side = "start",
  edge = "top",
  notchWidth,
  notchHeight,
  shoulder,
  avatars,
  className,
  children,
}: {
  side?: NotchSide;
  edge?: NotchEdge;
  notchWidth?: number;
  notchHeight?: number;
  shoulder?: React.ReactNode;
  avatars: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);

  const carve = useCallback(() => {
    const el = card.current;
    const wrap = wrapper.current;
    if (!el || !wrap) return;
    const dir = getComputedStyle(wrap).direction === "ltr" ? "ltr" : "rtl";
    const d = notchedCardPath(el.offsetWidth, el.offsetHeight, {
      side,
      edge,
      dir,
      notchWidth,
      notchHeight,
    });
    const clip = d ? `path("${d}")` : "";
    el.style.clipPath = clip;
    el.classList.toggle("notched", Boolean(d));
    wrap.style.setProperty("--notch-clip-path", clip);
  }, [side, edge, notchWidth, notchHeight]);

  useEffect(() => {
    carve();
    const ro = new ResizeObserver(carve);
    const el = card.current;
    if (el) ro.observe(el);
    // The card's height depends on the Persian glyphs inside it, so the box measured
    // before the webfont lands is not the box it ends up with.
    document.fonts?.ready.then(carve).catch(() => {});
    return () => ro.disconnect();
  }, [carve]);

  return (
    <div ref={wrapper} className={cn("notch-wrap", className)}>
      {/* The border/highlight ring: same clip-path as the card, inset 1px via a second
          nested clip, coloured as border + edge-highlight. Purely decorative, so it is
          aria-hidden. */}
      <div className="notch-edge" aria-hidden />
      <div ref={card} data-notch-clip className="notch-card noise-surface">
        {children}
      </div>
      {shoulder ? <div className="notch-shoulder">{shoulder}</div> : null}
      <div className="notch-avatars">{avatars}</div>
    </div>
  );
}
