/** The OSRM `/table` matrix call. Glue -- env-gated, `null` on any failure, exactly like
 *  `lib/osrm.ts`. `parseOsrmTable` (the shape check) is pure and tested; the fetch is
 *  not.
 */

import type { LatLng } from "@/lib/geo";
import { OSRM_BASE, fetchOsrmJson } from "./osrmFetch";

const TABLE_URL = process.env.OSRM_TABLE_URL ?? `${OSRM_BASE}/table/v1/driving`;

export interface OsrmTable {
  distances_km: number[][];
  durations_s: number[][];
}

/** OSRM answers `{code:"Ok", durations:[[…]], distances:[[…]]}` (metres, seconds).
 *  Anything else -- a non-"Ok" code, a ragged matrix, missing distances -- is null. */
export function parseOsrmTable(data: unknown): OsrmTable | null {
  if (typeof data !== "object" || data === null) return null;
  const b = data as { code?: unknown; durations?: unknown; distances?: unknown };
  if (b.code !== "Ok") return null;

  const grid = (v: unknown): number[][] | null => {
    if (!Array.isArray(v) || v.length === 0) return null;
    const n = v.length;
    const out: number[][] = [];
    for (const row of v) {
      if (!Array.isArray(row) || row.length !== n) return null;
      const r: number[] = [];
      for (const cell of row) {
        if (cell === null) r.push(0);
        else if (typeof cell === "number" && Number.isFinite(cell)) r.push(cell);
        else return null;
      }
      out.push(r);
    }
    return out;
  };

  const durations = grid(b.durations);
  const distances = grid(b.distances);
  if (!durations || !distances) return null;

  return {
    durations_s: durations,
    distances_km: distances.map((row) => row.map((m) => m / 1000)),
  };
}

export async function fetchOsrmTable(
  points: LatLng[],
  signal?: AbortSignal
): Promise<OsrmTable | null> {
  if (points.length < 2 || points.length > 100) return null;
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${TABLE_URL}/${coords}?annotations=duration,distance`;
  return parseOsrmTable(await fetchOsrmJson(url, signal));
}
