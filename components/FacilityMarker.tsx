"use client";

import type { ReactNode } from "react";
import { Marker } from "@vis.gl/react-maplibre";
import type { FacilityKind } from "@/lib/facilityTypes";
import { artFor, facilityMarkerHtml } from "./facilityArt";

/** One of our own sites on a map, in the same silhouette the legend and the sites editor
 *  draw (facilityArt.ts). The art's anchor is turned into an offset from the centre, so
 *  the house stands on its point and the hexagon sits on it. */
export default function FacilityMarker({
  lat,
  lng,
  kind,
  iconKey,
  name,
  onClick,
  children,
}: {
  lat: number;
  lng: number;
  kind: FacilityKind;
  iconKey?: string | null;
  name: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const { size, anchor } = artFor(iconKey, kind);
  return (
    <Marker
      longitude={lng}
      latitude={lat}
      offset={[size[0] / 2 - anchor[0], size[1] / 2 - anchor[1]]}
      style={{ zIndex: 1 }}
      onClick={onClick ? (e) => { e.originalEvent.stopPropagation(); onClick(); } : undefined}
    >
      <div title={name} role={onClick ? "button" : "img"} aria-label={name}
        dangerouslySetInnerHTML={{ __html: facilityMarkerHtml(iconKey, kind) }} />
      {children}
    </Marker>
  );
}
