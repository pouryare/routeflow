import crypto from "node:crypto";
import zlib from "node:zlib";
import { getDb } from "./db";
import { decimateGeometry, DistrictGeometry } from "./simplify";
import { PrecisionTier } from "./precision";

// District geometry is split off from /api/districts on purpose: `boundary_geojson` is
// insert/delete-only (the seed scripts and the draw-a-polygon POST write it; nothing
// ever edits one), while coverage_status/notes/assigned_to change all day. Serving them
// together meant re-sending ~600KB of unchanged polygons every time someone flipped one
// district to "visited". Now geometry lives at a version-stamped URL cached
// indefinitely, and /api/districts carries only the ~50KB of mutable properties.

/** low: ~33m tolerance -- under 2 CSS pixels at zoom <= 13, where the map opens.
 *  high: no simplification, 6 decimals (~11cm), which is lossless for anything a
 *  district boundary is used for. The client picks a tier by zoom (or by explicit user
 *  choice) -- see PRECISION_AUTO_ZOOM in components/CoverageMap.tsx. */
export const PRECISION_TIERS: Record<PrecisionTier, { tolerance: number; decimals: number }> = {
  low: { tolerance: 0.0003, decimals: 4 },
  high: { tolerance: 0, decimals: 6 },
};

/** Cheap signature of the geometry set, run per request. It has to change on any
 *  insert or delete but must NOT change on a status edit -- COUNT + MAX(id) + total
 *  byte length covers every write that can touch the column (an insert moves all
 *  three; a delete moves count and length), and skips the ~600KB read entirely. */
export function geometryVersion(): string {
  const db = getDb();
  const sig = db
    .prepare("SELECT COUNT(*) c, MAX(id) m, SUM(LENGTH(boundary_geojson)) b FROM districts")
    .get() as { c: number; m: number | null; b: number | null };
  return crypto
    .createHash("sha256")
    .update(`${sig.c}:${sig.m}:${sig.b}`)
    .digest("hex")
    .slice(0, 12);
}

export interface EncodedPayload {
  body: Buffer;
  encoding: "br" | "gzip" | "identity";
}

interface CacheEntry {
  identity: Buffer;
  br: Buffer;
  gzip: Buffer;
}

// Keyed "<version>:<tier>". Cleared wholesale whenever the version moves, so a stale
// generation can never be served and the map (at most 2 tiers) can't grow unbounded.
//
// Parked on globalThis rather than in module scope because Next bundles route handlers
// and instrumentation.ts separately: each bundle gets its own copy of this module, so a
// plain `const cache` would leave the startup warm-up filling a Map that the route
// handler never reads, and every deploy's first request would rebuild from scratch.
interface GeometryCache {
  entries: Map<string, CacheEntry>;
  version: string | null;
}
const globalCache = globalThis as typeof globalThis & { __districtGeometry?: GeometryCache };
const store: GeometryCache = (globalCache.__districtGeometry ??= {
  entries: new Map(),
  version: null,
});

/** Builds `{"<id>": <geometry>, ...}` by string concatenation. The old route did
 *  JSON.parse on all 430 stored geometries and let NextResponse.json re-serialize
 *  ~600KB on every single request; here each stored geometry is parsed once per
 *  (version, tier) and every later request is a straight buffer write. */
function buildPayload(tier: PrecisionTier): CacheEntry {
  const { tolerance, decimals } = PRECISION_TIERS[tier];
  const rows = getDb()
    .prepare("SELECT id, boundary_geojson FROM districts ORDER BY id")
    .all() as unknown as { id: number; boundary_geojson: string }[];

  const parts: string[] = [];
  for (const row of rows) {
    let geometry: DistrictGeometry;
    try {
      geometry = JSON.parse(row.boundary_geojson) as DistrictGeometry;
    } catch {
      // A malformed row shouldn't take the whole map down -- skip it; the district
      // still appears in the properties response, just without a drawable shape.
      continue;
    }
    parts.push(`"${row.id}":${JSON.stringify(decimateGeometry(geometry, tolerance, decimals))}`);
  }

  const identity = Buffer.from(`{${parts.join(",")}}`, "utf8");
  return {
    identity,
    // Quality 11 is the slow setting, but this runs once per deploy-or-edit and the
    // result is cached in memory and then in every client's disk cache indefinitely.
    br: zlib.brotliCompressSync(identity, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }),
    gzip: zlib.gzipSync(identity, { level: 9 }),
  };
}

export function getGeometryPayload(version: string, tier: PrecisionTier, acceptEncoding: string): EncodedPayload {
  if (store.version !== version) {
    store.entries.clear();
    store.version = version;
  }

  const key = `${version}:${tier}`;
  let entry = store.entries.get(key);
  if (!entry) {
    entry = buildPayload(tier);
    store.entries.set(key, entry);
  }

  const accepts = acceptEncoding.toLowerCase();
  if (accepts.includes("br")) return { body: entry.br, encoding: "br" };
  if (accepts.includes("gzip")) return { body: entry.gzip, encoding: "gzip" };
  return { body: entry.identity, encoding: "identity" };
}
