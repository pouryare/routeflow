"use client";

import { useRef, useState } from "react";
import type React from "react";

/** Pointer-drag for lane boards, factored out of the mechanics proven in
 *  components/sales/OrderPipeline.tsx:
 *
 *  - capture on the CARD, never the board, so the gesture (click included) keeps
 *    reporting which card it started on;
 *  - a travel threshold so a still finger is a tap, not a drag;
 *  - `elementFromPoint` every move (a lane can scroll/reflow mid-drag);
 *  - a short click-guard after a drop so the same gesture does not also "open" the card.
 *
 *  It is board-agnostic: the caller says how to read a lane id off the point
 *  (`resolveLane`) and what a drop means (`onDrop`).
 */

const DRAG_THRESHOLD = 6;
const CLICK_GUARD_MS = 60;

export interface DragState<T> {
  item: T;
  from: string;
  x: number;
  y: number;
  width: number;
  /** Where inside the card the grab happened; draw the ghost at x - dx, y - dy so it stays
   *  under the pointer exactly where it was picked up (item 22). */
  dx: number;
  dy: number;
}

export interface CardDrag<T> {
  /** Non-null while a drag is in flight — render a fixed-position ghost from it. */
  drag: DragState<T> | null;
  /** The lane id currently under the pointer, for a `.over` class. */
  hoverLane: string | null;
  /** True for ~60ms after a drop — an onClick handler should bail while it is true. */
  isSuppressed: () => boolean;
  /** Spread onto each draggable card element. */
  bind: (
    item: T,
    fromLane: string
  ) => Pick<
    React.DOMAttributes<Element>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
  >;
}

export function useCardDrag<T>(opts: {
  resolveLane: (x: number, y: number) => string | null;
  onDrop: (item: T, fromLane: string, toLane: string) => void;
}): CardDrag<T> {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const [hoverLane, setHoverLane] = useState<string | null>(null);

  const press = useRef<DragState<T> | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const hoverRef = useRef<string | null>(null);

  function bind(item: T, fromLane: string) {
    return {
      onPointerDown(e: React.PointerEvent) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        press.current = {
          item,
          from: fromLane,
          x: e.clientX,
          y: e.clientY,
          width: r.width,
          dx: e.clientX - r.left,
          dy: e.clientY - r.top,
        };
      },
      onPointerMove(e: React.PointerEvent) {
        const p = press.current;
        if (!p) return;
        if (!dragging.current) {
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
          dragging.current = true;
        }
        const lane = opts.resolveLane(e.clientX, e.clientY);
        hoverRef.current = lane;
        setHoverLane(lane);
        setDrag({ ...p, x: e.clientX, y: e.clientY });
      },
      onPointerUp() {
        const p = press.current;
        const wasDragging = dragging.current;
        const target = hoverRef.current;
        press.current = null;
        dragging.current = false;
        hoverRef.current = null;
        setDrag(null);
        setHoverLane(null);
        if (!p || !wasDragging) return;
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, CLICK_GUARD_MS);
        if (target && target !== p.from) opts.onDrop(p.item, p.from, target);
      },
      onPointerCancel() {
        press.current = null;
        dragging.current = false;
        hoverRef.current = null;
        setDrag(null);
        setHoverLane(null);
      },
    };
  }

  return { drag, hoverLane, isSuppressed: () => suppressClick.current, bind };
}
