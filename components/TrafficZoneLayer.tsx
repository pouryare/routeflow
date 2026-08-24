"use client";

import { useEffect, useMemo, useState } from "react";
import { Polygon, Tooltip } from "react-leaflet";
import {
  TRAFFIC_ZONES_URL,
  zoneStatusNow,
  type TrafficZoneProperties,
  type ZoneStatus,
} from "@/lib/trafficZones";
import { faDigits } from "@/lib/format";

export interface ZoneFeature {
  properties: TrafficZoneProperties;
  geometry: { coordinates: [number, number][][] };
}

/** Loads the baked zone file once and hands it back up.
 *
 *  A hook rather than a component so the map and the layers panel can both read the same
 *  fetch: the panel needs the hours to say "restricted until 17:00", the map needs the
 *  rings to draw, and asking twice would be two copies of the same 26KB.
 */
export function useTrafficZones(enabled: boolean): {
  zones: ZoneFeature[] | null;
  status: Record<string, ZoneStatus> | null;
} {
  const [zones, setZones] = useState<ZoneFeature[] | null>(null);
  // Re-derived every minute so a zone that opens at 17:00 stops saying "restricted" at
  // 17:01 without needing the page reloaded. A minute is finer than any of the boundaries.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || zones) return;
    let live = true;
    fetch(TRAFFIC_ZONES_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (live && data?.features) setZones(data.features as ZoneFeature[]);
      })
      .catch(() => {
        // The file is served from this app's own origin and is cached by the service
        // worker, so a failure here means the app itself is unreachable. Nothing useful
        // to say that the rest of the page is not already saying.
      });
    return () => {
      live = false;
    };
  }, [enabled, zones]);

  useEffect(() => {
    if (!zones) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [zones]);

  const status = useMemo(() => {
    if (!zones) return null;
    void tick;
    const out: Record<string, ZoneStatus> = {};
    for (const z of zones) out[z.properties.id] = zoneStatusNow(z.properties.restricted);
    return out;
  }, [zones, tick]);

  return { zones, status };
}

/** Colour says *which* restriction; weight and dashes say whether it is biting now.
 *
 *  Colouring an inactive zone grey was the first attempt, and on the map it was
 *  indistinguishable from the city boundary and the district borders, which are grey
 *  dashed lines too. A zone that can cost you a fine has to keep looking like one even
 *  while it happens to be open. */
const ZONE_COLOR: Record<string, string> = {
  limited_traffic: "#FF5C5C",
  low_emission: "#E8B93B",
};

/** The rings themselves.
 *
 *  Colour carries the only thing that changes: a zone you may drive into right now is
 *  drawn in the same grey as any other boundary, and one that would cost you a fine is
 *  drawn in red. Outline only, no fill -- a filled ring over central Tehran would bury
 *  every customer inside it, which is exactly where most of them are.
 */
export default function TrafficZoneLayer({
  zones,
  status,
  show,
}: {
  zones: ZoneFeature[] | null;
  status: Record<string, ZoneStatus> | null;
  /** Which zone ids to draw, by the panel's toggles. */
  show: Set<string>;
}) {
  if (!zones) return null;

  return (
    <>
      {zones
        .filter((z) => show.has(z.properties.id))
        .map((z) => {
          const state = status?.[z.properties.id]?.state ?? "unknown";
          const color = ZONE_COLOR[z.properties.id] ?? ZONE_COLOR.low_emission;
          const until = status?.[z.properties.id]?.until;
          const biting = state === "restricted";
          return (
            <Polygon
              key={z.properties.id}
              // Leaflet wants [lat, lng]; GeoJSON stores [lng, lat].
              positions={z.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number])}
              interactive
              pathOptions={{
                color,
                weight: biting ? 3 : 2,
                opacity: biting ? 0.95 : 0.55,
                fill: false,
                // Solid while it is enforced, dashed while it is not -- the same grammar
                // the rest of this map uses for "definite" against "provisional".
                dashArray: biting ? undefined : "7 6",
              }}
            >
              <Tooltip sticky direction="top">
                <span dir="rtl">
                  <span className="font-medium">{z.properties.name}</span>
                  {state === "restricted" && <span> — الان محدود{until ? ` تا ${faDigits(until)}` : ""}</span>}
                  {state === "free" && <span> — الان آزاد{until ? ` تا ${faDigits(until)}` : ""}</span>}
                  {state === "unknown" && <span> — ساعت‌هایش ثبت نشده</span>}
                </span>
              </Tooltip>
            </Polygon>
          );
        })}
    </>
  );
}
