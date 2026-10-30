"use client";

import { useEffect, useMemo, useRef } from "react";
import { Layer, Marker, Source, useMap } from "@vis.gl/react-maplibre";
import { geoCircle } from "@/components/map/geoCircle";
import { useMyPosition } from "./MyPositionProvider";

/** Metres beyond which the accuracy circle stops being informative and starts being a
 *  blue wash over half the city. Past this the dot is still drawn -- it is still the
 *  best guess available -- but the circle is not. */
const MAX_ACCURACY_CIRCLE_M = 2000;

/** The user's own position, on whatever map this is mounted inside.
 *
 *  Always present, never waiting to be asked for. This is the one thing on the map that
 *  answers "where am I". The marker element stays mounted and only moves on each fix. */
export default function MyLocationMarker({
  /** Fly to the first fix. Wanted on the small single-purpose maps, not on the main one,
   *  where the opening view is deliberately chosen by the link or by memory. */
  followFirstFix = false,
}: {
  followFirstFix?: boolean;
}) {
  const { current: map } = useMap();
  const { position } = useMyPosition();
  const flownRef = useRef(false);

  useEffect(() => {
    if (!position || !map || !followFirstFix || flownRef.current) return;
    flownRef.current = true;
    map.flyTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 14), duration: 1000 });
  }, [position, map, followFirstFix]);

  const circle = useMemo(
    () =>
      position && position.accuracy > 0 && position.accuracy <= MAX_ACCURACY_CIRCLE_M
        ? geoCircle(position.lat, position.lng, position.accuracy)
        : null,
    [position],
  );

  if (!position) return null;
  return (
    <>
      {circle && (
        <Source id="me-accuracy" type="geojson" data={circle}>
          <Layer id="me-accuracy-fill" type="fill" paint={{ "fill-color": "#2DE0E6", "fill-opacity": 0.08 }} />
          <Layer id="me-accuracy-line" type="line" paint={{ "line-color": "#2DE0E6", "line-opacity": 0.5, "line-width": 1 }} />
        </Source>
      )}
      {/* Last in the tree so it sits above every other marker: it is the reference point
          the rest of the map is read against. */}
      <Marker longitude={position.lng} latitude={position.lat} style={{ zIndex: 3 }}>
        <div className="me-marker" aria-hidden="true">
          <span className="me-marker__ping" />
          <span className="me-marker__dot" />
        </div>
      </Marker>
    </>
  );
}
