"use client";

import { useMap } from "@vis.gl/react-maplibre";
import { Icon } from "@/components/meridian/Icon";
import MapButton from "@/components/map/MapButton";
import { useMyPosition } from "./MyPositionProvider";

/** The ◎ button: recentre on me.
 *
 *  The marker comes from MyLocationMarker and tracks continuously, so all this button
 *  does is move the viewport, or ask for the position again when there is none.
 *
 *  It reports state through its own appearance: dim while there is no fix, lit once
 *  there is one. A button that looks identical whether or not the app knows where you
 *  are is a button you press hopefully. */
export default function LocateControl() {
  const { current: map } = useMap();
  const { position, status, retry } = useMyPosition();
  const label =
    status === "denied"
      ? "دسترسی به موقعیت داده نشده — برای تلاش دوباره بزنید"
      : status === "active"
        ? "رفتن به موقعیت من"
        : "در حال یافتن موقعیت…";
  return (
    <MapButton
      label={label}
      className={`locate-control${status === "active" ? " locate-control--active" : ""}${status === "denied" ? " locate-control--denied" : ""}`}
      onClick={() => {
        if (!position) return retry();
        map?.flyTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 16), duration: 1000 });
      }}
    >
      <Icon name="locate" size="md" />
    </MapButton>
  );
}
