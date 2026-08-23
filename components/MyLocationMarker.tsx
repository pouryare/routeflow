"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useMyPosition } from "./MyPositionProvider";

/** Metres beyond which the accuracy circle stops being informative and starts being a
 *  blue wash over half the city. Past this the dot is still drawn -- it is still the
 *  best guess available -- but the circle is not. */
const MAX_ACCURACY_CIRCLE_M = 2000;

/** The user's own position, on whatever map this is mounted inside.
 *
 *  Drawn imperatively rather than as a <Marker>: it moves on every GPS fix, and a React
 *  element would remount the marker's DOM each time -- which on this map means competing
 *  with 430 district polygons for the same frame. setLatLng moves the existing node.
 *
 *  Always present, never waiting to be asked for. This is the one thing on the map that
 *  answers "where am I", and it was previously behind a button that produced a marker
 *  frozen at the moment you pressed it.
 */
export default function MyLocationMarker({
  /** Fly to the first fix. Wanted on the small single-purpose maps, not on the main one,
   *  where the opening view is deliberately chosen by the link or by memory. */
  followFirstFix = false,
}: {
  followFirstFix?: boolean;
}) {
  const map = useMap();
  const { position } = useMyPosition();
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const flownRef = useRef(false);

  useEffect(() => {
    if (!position) return;
    const latlng: L.LatLngExpression = [position.lat, position.lng];

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
    } else {
      markerRef.current = L.marker(latlng, {
        icon: L.divIcon({
          className: "",
          html: `<div class="me-marker"><span class="me-marker__ping" aria-hidden="true"></span><span class="me-marker__dot"></span></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        // Above every other marker including our own sites: this one is the reference
        // point the rest of the map is read against.
        zIndexOffset: 2000,
        interactive: false,
        keyboard: false,
      }).addTo(map);
    }

    const showCircle = position.accuracy > 0 && position.accuracy <= MAX_ACCURACY_CIRCLE_M;
    if (showCircle) {
      if (circleRef.current) {
        circleRef.current.setLatLng(latlng).setRadius(position.accuracy);
      } else {
        circleRef.current = L.circle(latlng, {
          radius: position.accuracy,
          interactive: false,
          color: "#2DE0E6",
          weight: 1,
          opacity: 0.5,
          fillColor: "#2DE0E6",
          fillOpacity: 0.08,
        }).addTo(map);
      }
    } else if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }

    if (followFirstFix && !flownRef.current) {
      flownRef.current = true;
      map.flyTo(latlng, Math.max(map.getZoom(), 14), { duration: 1 });
    }
  }, [position, map, followFirstFix]);

  useEffect(() => {
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      circleRef.current?.remove();
      circleRef.current = null;
    };
  }, []);

  return null;
}
