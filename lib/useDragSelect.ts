"use client";

import { useRef } from "react";
import { paintId, toggleId } from "@/lib/selection";
import { buzz } from "@/lib/haptic";

/** Drag select over tick boxes once select mode is on: press a tick and slide over the others; the first
 *  one decides add or remove (lib/selection paintId). Spread `tick(id)` on each tick button. A keyboard
 *  or screen-reader press (no pointer) still toggles one tick. */
export function useDragSelect(selected: ReadonlySet<number>, set: (next: Set<number>) => void) {
  const drag = useRef<{ on: boolean; seen: Set<number>; sel: Set<number> } | null>(null);

  const visit = (id: number) => {
    const d = drag.current;
    if (!d || d.seen.has(id)) return;
    d.seen.add(id);
    d.sel = paintId(d.sel, id, d.on);
    set(d.sel);
    buzz(6);
  };

  return (id: number) => ({
    "data-pick-id": id,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      // Let the moves land on whichever tick is under the finger, not on this one.
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      drag.current = { on: !selected.has(id), seen: new Set(), sel: new Set(selected) };
      visit(id);
      const move = (ev: PointerEvent) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-pick-id]");
        if (el) visit(Number(el.dataset.pickId));
      };
      const up = () => {
        drag.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      if (e.detail === 0) set(toggleId(selected, id));
    },
  });
}
