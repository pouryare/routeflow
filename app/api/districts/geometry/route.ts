import { NextRequest, NextResponse } from "next/server";
import { geometryVersion, getGeometryPayload } from "@/lib/districtGeometry";
import { isPrecisionTier } from "@/lib/precision";

// Version-stamped, immutable district geometry. The `v` param is produced by
// geometryVersion() and handed to the client in the page's initial props, so a client
// asking for a version we no longer have is asking for a stale generation -- it gets
// redirected to the current one rather than a 404, which keeps a long-open tab working.
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("v");
  const tierParam = req.nextUrl.searchParams.get("p");
  const tier = isPrecisionTier(tierParam) ? tierParam : "low";
  const version = geometryVersion();

  if (requested !== version) {
    const url = req.nextUrl.clone();
    url.searchParams.set("v", version);
    url.searchParams.set("p", tier);
    return NextResponse.redirect(url, 307);
  }

  const { body, encoding } = getGeometryPayload(version, tier, req.headers.get("accept-encoding") ?? "");

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    // "private", not "public": this route sits behind the session gate in proxy.ts, so
    // only the requesting browser (and its service worker) may keep a copy. The URL is
    // content-versioned, so that copy never needs revalidating.
    "Cache-Control": "private, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
  });
  // Setting Content-Encoding ourselves also stops Next's own gzip middleware from
  // re-compressing an already-compressed body.
  if (encoding !== "identity") headers.set("Content-Encoding", encoding);

  return new NextResponse(new Uint8Array(body), { status: 200, headers });
}
