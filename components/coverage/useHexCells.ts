"use client";

import { useEffect, useState } from "react";
import type { HexCell } from "@/lib/h3";
import type { HexMetric } from "@/lib/repo/hexMap";

/** The honeycomb numbers from /api/map/hex while the layer is on. Fetching waits for it to be switched on,
 *  so a map with the layer off never pays for the counting. */
export function useHexCells(on: boolean, metric: HexMetric, res: number, days: number) {
  const [state, setState] = useState<{ key: string; cells: HexCell[]; error: string | null }>({ key: "", cells: [], error: null });
  const key = `${metric}:${res}:${days}`;
  useEffect(() => {
    if (!on) return;
    const ctl = new AbortController();
    fetch(`/api/map/hex?metric=${metric}&res=${res}&days=${days}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = (await r.json()) as { ok: boolean; cells?: HexCell[]; error?: string };
        setState({ key, cells: j.ok ? (j.cells ?? []) : [], error: j.ok ? null : (j.error ?? "خواندن نشد") });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== "AbortError") setState({ key, cells: [], error: "خواندن نشد؛ اینترنت را بررسی کنید" });
      });
    return () => ctl.abort();
  }, [on, key, metric, res, days]);
  return { cells: state.cells, error: state.error, loading: on && state.key !== key };
}
