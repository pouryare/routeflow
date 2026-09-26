"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";
import { QUIET_TILES } from "@/lib/mapLayers";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { LiveItem } from "./LiveItemList";

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
 *  Loaded through next/dynamic with ssr:false by the console, because leaflet reads
 *  `window` on import -- see components/MapLoader.tsx for the established shape. */
export default function ImportMap({ items }: { items: LiveItem[] }) {
  const pins = usePins(items);

  return (
    <div className="h-56 overflow-hidden rounded-[var(--radius-md)] border border-border">
      <MapContainer
        center={pins.length > 0 ? [pins[0].lat, pins[0].lng] : TEHRAN}
        zoom={pins.length > 0 ? 11 : 10}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
        zoomControl={false}
      >
        {/* Fields named, never spread. QUIET_TILES carries `subdomains: undefined`, and
            Leaflet's _getSubdomain reads `.length` off whatever it is handed -- spreading
            the object passes that undefined straight through and throws
            "Cannot read properties of undefined (reading 'length')" on the first tile
            request, which unmounts the whole page. LeadsMap names these same four fields
            for the same reason. */}
        <TileLayer
          url={QUIET_TILES.url}
          attribution={QUIET_TILES.attribution}
          className="tiles-quiet"
          maxZoom={QUIET_TILES.maxZoom}
        />
        <FitToPins pins={pins} />
        {pins.map((pin) => (
          <DroppingPin key={pin.id} pin={pin} />
        ))}
      </MapContainer>
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
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    // Once only. Re-fitting on every poll would move the map under the user's cursor
    // while they are watching the import, which is worse than a slightly loose frame.
    if (fitted.current || pins.length === 0) return;
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 12);
      fitted.current = true;
      return;
    }
    map.fitBounds(pins.map((p) => [p.lat, p.lng] as [number, number]), { padding: [24, 24] });
    fitted.current = true;
  }, [map, pins]);

  return null;
}

function DroppingPin({ pin }: { pin: ImportPin }) {
  const reduced = usePrefersReducedMotion();
  return (
    <CircleMarker
      center={[pin.lat, pin.lng]}
      radius={reduced ? 5 : 6}
      pathOptions={{
        color: "var(--accent)",
        fillColor: "var(--accent)",
        fillOpacity: reduced ? 0.9 : 0.35,
        weight: 2,
        opacity: 0.95,
        // The pulse is the drop: a short ring expanding from the pin on arrival. Under
        // reduced motion it is simply absent, and the pin is still there.
        className: reduced ? undefined : "leadimport-pin-drop",
      }}
    />
  );
}
