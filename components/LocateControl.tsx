"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useMyPosition } from "./MyPositionProvider";

const LOCATE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>';

/** The ◎ button: recentre on me.
 *
 *  It used to *be* the location feature -- one getCurrentPosition, one marker dropped
 *  where you happened to be standing when you pressed it, frozen there for the rest of
 *  the session. The marker now comes from MyLocationMarker and tracks continuously, so
 *  all this button has left to do is move the viewport, which is the only thing it was
 *  ever really for.
 *
 *  It reports state through its own appearance: dim while there is no fix, lit once
 *  there is one. A button that looks identical whether or not the app knows where you
 *  are is a button you press hopefully.
 */
export default function LocateControl() {
  const map = useMap();
  const { position, status, retry } = useMyPosition();
  const buttonRef = useRef<HTMLAnchorElement | null>(null);

  // The Leaflet control is created once and its click handler captured then, so it needs
  // a stable way to see the current fix. Written in an effect rather than during render:
  // a ref assigned while rendering is a side effect in the render pass.
  const latestRef = useRef({ position, retry });
  useEffect(() => {
    latestRef.current = { position, retry };
  }, [position, retry]);

  const recentre = useCallback(() => {
    const { position: pos, retry: askAgain } = latestRef.current;
    if (!pos) {
      // Nothing to centre on. Asking again is the only useful thing a press can mean.
      askAgain();
      return;
    }
    map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 16), { duration: 1 });
  }, [map]);

  useEffect(() => {
    const LocateButton = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control locate-control");
        const button = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        button.href = "#";
        button.title = "رفتن به موقعیت من";
        /* Leaflet builds this control as raw DOM, so a React <Icon> cannot render here. This
           is lucide's locate-fixed, the same glyph as <Icon name="locate" />, inline. */
        button.innerHTML = LOCATE_SVG;
        button.setAttribute("role", "button");
        button.setAttribute("aria-label", "رفتن به موقعیت من");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", (e) => {
          L.DomEvent.preventDefault(e);
          recentre();
        });
        buttonRef.current = button;
        return container;
      },
      onRemove() {
        buttonRef.current = null;
      },
    });
    const control = new LocateButton({ position: "topleft" });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, recentre]);

  // Reflects whether there is anything to recentre *on*, rather than whether a request
  // is in flight -- which is what the user actually needs to know before pressing it.
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    button.classList.toggle("locate-control--active", status === "active");
    button.classList.toggle("locate-control--denied", status === "denied");
    button.title =
      status === "denied"
        ? "دسترسی به موقعیت داده نشده — برای تلاش دوباره بزنید"
        : status === "active"
          ? "رفتن به موقعیت من"
          : "در حال یافتن موقعیت…";
  }, [status]);

  return null;
}
