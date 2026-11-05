"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MapLayerTouchEvent, MapTouchEvent } from "maplibre-gl";
import type { MapRef } from "@vis.gl/react-maplibre";
import { HOLD_PIN_MS, HOLD_PIN_SLOP_PX } from "@/lib/pinFan";

/** Hold a customer pin (one finger, little drift) and `onHold` gets that customer; a short touch is still a tap.
 *  The map's own touchstart on the pin layer starts the timer; moving, lifting or a second finger cancels it. */
export function usePinHold<T>(map: MapRef | undefined, byId: Map<number, T>, onHold: (c: T) => void): () => boolean {
  /* The finger that opened the fan also lifts, which MapLibre reads as a tap: callers ignore taps just after a hold. */
  const heldAt = useRef(0);
  const justHeld = useCallback(() => Date.now() - heldAt.current < 800, []);
  useEffect(() => {
    if (!map) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let from: { x: number; y: number } | null = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      from = null;
    };
    const start = (e: MapLayerTouchEvent) => {
      const f = e.features?.[0];
      const c = f ? byId.get(Number(f.properties.id)) : undefined;
      if (!c || e.points.length !== 1) return;
      from = { x: e.point.x, y: e.point.y };
      timer = setTimeout(() => {
        timer = undefined;
        heldAt.current = Date.now();
        onHold(c);
      }, HOLD_PIN_MS);
    };
    const move = (e: MapTouchEvent) => {
      if (from && Math.hypot(e.point.x - from.x, e.point.y - from.y) > HOLD_PIN_SLOP_PX) cancel();
    };
    map.on("touchstart", "customers", start);
    map.on("touchmove", move);
    map.on("touchend", cancel);
    map.on("touchcancel", cancel);
    return () => {
      cancel();
      map.off("touchstart", "customers", start);
      map.off("touchmove", move);
      map.off("touchend", cancel);
      map.off("touchcancel", cancel);
    };
  }, [map, byId, onHold]);
  return justHeld;
}
