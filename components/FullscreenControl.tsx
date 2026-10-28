"use client";

import { useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-maplibre";
import { Icon } from "@/components/meridian/Icon";
import MapButton from "@/components/map/MapButton";

/** Full screen for the map's own box. Where the browser has no Fullscreen API (iPhone
 *  Safari), the box is pinned over the page instead, which reads the same. */
export default function FullscreenControl() {
  const { current: map } = useMap();
  const [on, setOn] = useState(false);
  const box = map?.getContainer();

  useEffect(() => {
    if (!box) return;
    const sync = () => setOn(document.fullscreenElement === box || box.classList.contains("map-pseudo-fullscreen"));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [box]);
  useEffect(() => {
    // The canvas has to learn its new size after either kind of switch.
    map?.resize();
  }, [map, on]);

  function toggle() {
    if (!box) return;
    if (document.fullscreenEnabled) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void box.requestFullscreen();
      return;
    }
    setOn(box.classList.toggle("map-pseudo-fullscreen"));
  }

  return (
    <MapButton label={on ? "خروج از تمام صفحه" : "تمام صفحه"} onClick={toggle}>
      <Icon name={on ? "minimize" : "maximize"} size="md" />
    </MapButton>
  );
}
