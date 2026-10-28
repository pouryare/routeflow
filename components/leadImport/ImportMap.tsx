"use client";

import { useEffect, useMemo, useRef } from "react";
import { Marker, useMap } from "@vis.gl/react-maplibre";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { LiveItem } from "./LiveItemList";
import AppMap from "@/components/map/AppMap";

/** Tehran, used until a pin lands to give the frame something to centre on. */
const TEHRAN: [number, number] = [35.6892, 51.389];

export interface ImportPin {
  id: number;
  lat: number;
  lng: number;
  name: string;
  /** When the pin arrived, for the settle animation. */
  landedAt: number;
}

/** The map behind a running import.
 *
 *  It exists to make the *shape of the remaining work* visible: a scatter of pins that
 *  lands in a rush while the cheap tier clears, then a trickle, then a handful of
 *  stragglers each one visibly grinding through a browser page. That contrast is the
 *  honest picture of the job, and it is the reason this is a real map rather than a
 *  decorative graphic.
 *
 *  Loaded through next/dynamic with ssr:false by the console, because MapLibre reads
 *  `window` on import. */
export default function ImportMap({ items }: { items: LiveItem[] }) {
  const pins = usePins(items);

  return (
    <div className="h-56 overflow-hidden rounded-[var(--radius-md)] border border-border">
      <AppMap
        initialViewState={{
          latitude: pins.length > 0 ? pins[0].lat : TEHRAN[0],
          longitude: pins.length > 0 ? pins[0].lng : TEHRAN[1],
          zoom: pins.length > 0 ? 11 : 10,
        }}
        scrollZoom={false}
        zoomButtons={false}
      >
        <FitToPins pins={pins} />
        {pins.map((pin) => (
          <DroppingPin key={pin.id} pin={pin} />
        ))}
      </AppMap>
    </div>
  );
}

/** Pins for everything decoded so far, plus the count still outstanding, which the
 *  caption reports so the map is never mistaken for the finished list. */
export function usePins(items: LiveItem[]): ImportPin[] {
  return useMemo(
    () =>
      items
        .filter((i) => i.lat !== null && i.lng !== null)
        .map((i) => ({
          id: i.id,
          lat: i.lat as number,
          lng: i.lng as number,
          name: i.name || "مکان بدون نام",
          landedAt: 0,
        })),
    [items]
  );
}

/** Keeps the whole batch in view as it arrives, without yanking the map on every pin. */
function FitToPins({ pins }: { pins: ImportPin[] }) {
  const { current: map } = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    // Once only. Re-fitting on every poll would move the map under the user's cursor
    // while they are watching the import, which is worse than a slightly loose frame.
    if (!map || fitted.current || pins.length === 0) return;
    if (pins.length === 1) {
      map.jumpTo({ center: [pins[0].lng, pins[0].lat], zoom: 12 });
      fitted.current = true;
      return;
    }
    map.fitBounds(pinBounds(pins), { padding: 24, duration: 0 });
    fitted.current = true;
  }, [map, pins]);

  return null;
}

/** [[west, south], [east, north]] around the pins. */
function pinBounds(pins: { lat: number; lng: number }[]): [[number, number], [number, number]] {
  const lngs = pins.map((p) => p.lng), lats = pins.map((p) => p.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

function DroppingPin({ pin }: { pin: ImportPin }) {
  const reduced = usePrefersReducedMotion();
  // The pulse is the drop: a short ring expanding from the pin on arrival. Under reduced
  // motion it is simply absent, and the pin is still there.
  return (
    <Marker longitude={pin.lng} latitude={pin.lat}>
      <div className={`leadimport-pin${reduced ? "" : " leadimport-pin-drop"}`} title={pin.name} />
    </Marker>
  );
}
