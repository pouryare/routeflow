import { NextRequest, NextResponse } from "next/server";
import zlib from "node:zlib";
import { parseTileCoord, readTile } from "@/lib/mapTiles";

// Public on purpose (see proxy.ts): the tiles are OpenStreetMap's open data, and a
// cookie-free request is what lets the CDN cache them for every user.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/map/tiles/[z]/[x]/[y]">) {
  const { z, x, y } = await ctx.params;
  const c = parseTileCoord(z, x, y);
  if (!c) return NextResponse.json({ ok: false, error: "کاشی نامعتبر" }, { status: 400 });

  let tile: Buffer | null;
  try {
    tile = await readTile(c.z, c.x, c.y);
  } catch {
    // The file has not been put on this server yet (docs/map-tiles.md).
    return NextResponse.json({ ok: false, error: "فایل نقشه روی سرور نیست" }, { status: 503 });
  }
  // A week: the file is refreshed every few months, and a stale tile is harmless.
  const cache = "public, max-age=604800";
  // No tile here (open sea, outside the extract): MapLibre draws an empty 204 as blank ground.
  if (!tile) return new NextResponse(null, { status: 204, headers: { "Cache-Control": cache } });

  const gzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  return new NextResponse(new Uint8Array(gzip ? zlib.gzipSync(tile) : tile), {
    headers: {
      "Content-Type": "application/x-protobuf",
      "Cache-Control": cache,
      Vary: "Accept-Encoding",
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
    },
  });
}
