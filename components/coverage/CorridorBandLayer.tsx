"use client";

import { Polygon, Polyline } from "react-leaflet";
import { useCorridor } from "@/components/coverage/useCorridor";
import { FACILITY_COLOR } from "@/lib/facilityTypes";

/** The corridor band and the dashed line down its middle, drawn inside the map. */
export default function CorridorBandLayer({ corridorOn, corridorEnds, corridorBand, corridorPath, lightGround }: {
  corridorOn: boolean;
  corridorEnds: ReturnType<typeof useCorridor>["ends"];
  corridorBand: ReturnType<typeof useCorridor>["band"];
  corridorPath: ReturnType<typeof useCorridor>["path"];
  lightGround: boolean;
}) {
  if (!(corridorOn && corridorEnds && corridorBand.length > 0)) return null;
  return (
          <>
            {/* A 7% fill and a half-opacity edge were tuned against a near-black
                ground; over a cream basemap the band all but disappears. Same colour,
                carried harder -- the corridor still reads as one thing on both. */}
            <Polygon
              positions={corridorBand}
              interactive={false}
              pathOptions={{
                color: FACILITY_COLOR,
                weight: 1,
                opacity: lightGround ? 0.75 : 0.5,
                fillColor: FACILITY_COLOR,
                fillOpacity: lightGround ? 0.13 : 0.07,
              }}
            />
            <Polyline
              positions={corridorPath.map((p) => [p.lat, p.lng] as [number, number])}
              interactive={false}
              pathOptions={{
                color: FACILITY_COLOR,
                weight: 2,
                opacity: lightGround ? 0.9 : 0.75,
                dashArray: "8 6",
              }}
            />
          </>
  );
}
