"use client";

import type { RefObject } from "react";
import { useEffect } from "react";
import type { MapRef } from "@vis.gl/react-maplibre";
import { CustomerRow } from "@/lib/types";

/** Keyboard shortcuts for the map, for the half of this app's life that happens at a desk. Moved out of CoverageMap unchanged. */
export function useMapShortcuts({
  searchInputRef, sectionFilterRef, mapRef, myPosition, retryPosition, toast,
  showShortcuts, setShowShortcuts, selectedCustomer, setSelectedCustomer, sidebarOpen, setSidebarOpen,
}: {
  searchInputRef: RefObject<HTMLInputElement | null>;
  sectionFilterRef: RefObject<HTMLInputElement | null>;
  mapRef: RefObject<MapRef | null>;
  myPosition: { lat: number; lng: number } | null;
  retryPosition: () => void;
  toast: (message: string, kind: "info" | "success" | "error") => void;
  showShortcuts: boolean;
  setShowShortcuts: (v: boolean) => void;
  selectedCustomer: CustomerRow | null;
  setSelectedCustomer: (c: CustomerRow | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (f: boolean | ((v: boolean) => boolean)) => void;
}) {
  /** Keyboard shortcuts, for the half of this app's life that happens at a desk.
   *
   *  Every one is a single unmodified key, which is only safe because of the guard
   *  below: without it, typing a customer's name into the search box would toggle the
   *  sidebar on every "s". */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "s":
        case "S":
          setSidebarOpen((v) => !v);
          break;
        case "f":
        case "F":
          e.preventDefault();
          // Opening the sidebar and focusing its filter are one action: the box does not
          // exist to be focused while the panel is shut.
          setSidebarOpen(true);
          window.setTimeout(() => sectionFilterRef.current?.focus(), 50);
          break;
        case "g":
        case "G":
          if (myPosition) mapRef.current?.flyTo({ center: [myPosition.lng, myPosition.lat], zoom: 16, duration: 1000 });
          else {
            toast("هنوز موقعیتی دریافت نشده", "info");
            retryPosition();
          }
          break;
        case "?":
        case "؟":
          setShowShortcuts(true);
          break;
        case "Escape":
          // Innermost first: Escape should peel one layer, not clear the screen.
          if (showShortcuts) setShowShortcuts(false);
          else if (selectedCustomer) setSelectedCustomer(null);
          else if (sidebarOpen) setSidebarOpen(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showShortcuts, selectedCustomer, sidebarOpen, toast, myPosition, retryPosition, mapRef, searchInputRef, sectionFilterRef, setSelectedCustomer, setShowShortcuts, setSidebarOpen]);
}
