import path from "node:path";
import fs from "node:fs/promises";
import { PMTiles, type Source } from "pmtiles";

/** The basemap's vector tiles, read out of one Protomaps PMTiles file on this server.
 *
 *  Tiles come from our own host so no map request leaves the country (owner's decision,
 *  2026-10-28). The phone never sees the PMTiles file: it asks for plain /z/x/y tiles, so
 *  the CDN caches each small tile like any other file and no Range request has to cross
 *  it (Arvan only caches whole files up to 100 MB, and caching a file per byte range is
 *  not documented). The file covers Tehran province (owner's choice, 2026-10-28).
 *  Building and refreshing it: docs/map-tiles.md. */
export const MAP_TILES_FILE =
  process.env.ROUTEFLOW_MAP_TILES ?? path.join(process.cwd(), "data", "map", "basemap.pmtiles");

/** Deepest zoom stored in the file. MapLibre over-zooms the z15 tiles past this. */
export const MAP_TILES_MAX_ZOOM = 15;

/** z/x/y from the URL, or null when it is not a tile this file could hold. */
export function parseTileCoord(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (![z, x, y].every((s) => /^\d{1,6}$/.test(s))) return null;
  const c = { z: Number(z), x: Number(x), y: Number(y) };
  if (c.z > MAP_TILES_MAX_ZOOM) return null;
  const n = 2 ** c.z;
  return c.x < n && c.y < n ? c : null;
}

/** Reads byte ranges of the local file. The handle stays open for the life of the
 *  process; replacing the file means restarting the app (docs/map-tiles.md). */
function fileSource(file: string): Source {
  const handle = fs.open(file, "r");
  handle.catch(() => {}); // a missing file surfaces from getBytes, not as an unhandled rejection
  return {
    getKey: () => file,
    async getBytes(offset, length) {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await (await handle).read(buf, 0, length, offset);
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
    },
  };
}

let archive: PMTiles | null = null;

/** The tile's protobuf bytes, or null when the file has no tile there. Throws when the
 *  file is missing. */
export async function readTile(z: number, x: number, y: number): Promise<Buffer | null> {
  archive ??= new PMTiles(fileSource(MAP_TILES_FILE));
  try {
    const tile = await archive.getZxy(z, x, y);
    return tile ? Buffer.from(tile.data) : null;
  } catch (err) {
    archive = null; // a missing file is retried on the next request, after it is copied in
    throw err;
  }
}
