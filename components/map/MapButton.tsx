"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useControl, type ControlPosition } from "@vis.gl/react-maplibre";

/** A round map button in MapLibre's control corners, drawn with React. Used for locate
 *  and fullscreen so they wear the app's own icons and sit in the same stack as the zoom
 *  buttons. */
export default function MapButton({
  label,
  onClick,
  className,
  expanded,
  position = "top-left",
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  /** For a button that opens a panel. */
  expanded?: boolean;
  position?: ControlPosition;
  children: ReactNode;
}) {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl maplibregl-ctrl-group";
    return el;
  });
  useControl(() => ({ onAdd: () => host, onRemove: () => host.remove() }), { position });
  return createPortal(
    <button type="button" className={`map-button ${className ?? ""}`} title={label} aria-label={label} aria-expanded={expanded} onClick={onClick}>
      {/* No icon here: every caller passes its own <Icon> as the children. */}
      {children}
    </button>,
    host,
  );
}
