"use client";

import { useEffect, useMemo, useState } from "react";
import { Polygon, Tooltip } from "react-leaflet";
import {
  QUOTA_DAYS,
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
 *  while it happens to be open.
 *
 *  Red for the permit zone and amber for the quota zone, matching the crit/warn pair the
 *  rest of the app uses: one turns you back, the other charges you. */
const ZONE_COLOR: Record<"light" | "dark", Record<string, string>> = {
  /* Per skin, and the light set is much darker than the dark one rather than the same
     colour reused. Measured: the old #FF5C5C and #E8B93B, composited at the inactive
     0.55 opacity over the کارگاه cream ground, came to 1.76:1 and 1.30:1 -- the borders
     were invisible in light mode, which is the bug this fixes. */
  light: {
    limited_traffic: "#8E1026",
    low_emission: "#7A5409",
  },
  dark: {
    limited_traffic: "#FF7A7A",
    low_emission: "#F0C64E",
  },
};

/* The inactive stroke's opacity, per skin.
 *
 * 0.55 was chosen against a near-black map, where a bright line at 55% still carries. On
 * a pale ground it is what made even a near-black red fail -- no colour reaches 3:1 at
 * that opacity over cream. Raising it in light keeps the line readable; the distinction
 * between "biting" and "not" is still carried by weight and by the dash, which is where
 * it belonged anyway. */
const INACTIVE_OPACITY: Record<"light" | "dark", number> = { light: 0.85, dark: 0.55 };

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
  ground,
}: {
  zones: ZoneFeature[] | null;
  status: Record<string, ZoneStatus> | null;
  /** Which zone ids to draw, by the panel's toggles. */
  show: Set<string>;
  /** What the chosen basemap's ground looks like. These rings are drawn on the basemap,
   *  not on the page, so they follow it rather than the skin -- see MAP_INK. */
  ground: "light" | "dark";
}) {
  /* Leaflet writes these onto a canvas path, so the colour has to be resolved in JS --
     var() does not reach the canvas renderer. Same reason MAP_INK exists. */
  const palette = ZONE_COLOR[ground];

  if (!zones) return null;

  return (
    <>
      {zones
        .filter((z) => show.has(z.properties.id))
        .map((z) => {
          const state = status?.[z.properties.id]?.state ?? "unknown";
          const color = palette[z.properties.id] ?? palette.low_emission;
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
                opacity: biting ? 0.95 : INACTIVE_OPACITY[ground],
                fill: false,
                // Solid while it is enforced, dashed while it is not -- the same grammar
                // the rest of this map uses for "definite" against "provisional".
                dashArray: biting ? undefined : "7 6",
              }}
            >
              <Tooltip sticky direction="top">
                <span dir="rtl">
                  <span className="font-medium">{z.properties.name}</span>
                  {biting && z.properties.kind === "permit" && (
                    <span> — الان محدود{until ? ` تا ${faDigits(until)}` : ""}؛ بدون مجوز وارد نشوید</span>
                  )}
                  {biting && z.properties.kind === "quota" && (
                    <span>
                      {" "}
                      — الان طرح است{until ? ` تا ${faDigits(until)}` : ""}؛ ورود یک روز از سهمیه فصلی
                      ({faDigits(String(QUOTA_DAYS.tehran))} روز با پلاک تهران) کم می‌کند
                    </span>
                  )}
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
