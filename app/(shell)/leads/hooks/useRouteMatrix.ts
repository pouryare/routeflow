"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchOsrmTable } from "@/lib/routing/osrmMatrix";
import type { LatLng } from "@/lib/geo";

export function useRouteMatrix(points: LatLng[]) {
  const [matrix, setMatrix] = useState<number[][] | null>(null);
  const fetched = useRef(false);

  const load = useCallback(async () => {
    if (fetched.current || points.length < 2 || points.length > 100) return;
    try {
      const controller = new AbortController();
      const table = await fetchOsrmTable(points, controller.signal);
      if (table) { setMatrix(table.distances_km); fetched.current = true; }
    } catch { /* silently ignore */ }
  }, [points.map((p) => `${p.lat},${p.lng}`).join("|")]);

  useEffect(() => { load(); return () => {}; }, [load]);

  return { matrix };
}
