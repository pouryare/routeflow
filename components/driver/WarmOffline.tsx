"use client";

import { useEffect } from "react";

/** Asks the service worker to keep a fresh copy of pages a van role needs at a door with no signal. It runs
 *  whenever /driver opens, so the copy is never older than the day's first look at the route. */
export default function WarmOffline({ urls }: { urls: string[] }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm", urls })).catch(() => {});
  }, [urls]);
  return null;
}
