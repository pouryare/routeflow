import { NextRequest, NextResponse } from "next/server";
import { geometryVersion, getGeometryPayload } from "@/lib/districtGeometry";
import { isPrecisionTier } from "@/lib/precision";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// Version-stamped, immutable district geometry. The `v` param is produced by
// geometryVersion() and handed to the client in the page's initial props, so a client
// asking for a version we no longer have is asking for a stale generation -- it gets
// redirected to the current one rather than a 404, which keeps a long-open tab working.
// Not in the plan's file list, but it is a route under app/api and Step 8's grep would
// have caught it. Guarded by role; the payload itself is deliberately NOT scoped --
// it is administrative boundary shapes with no coverage, assignment or customer data
// in it, and the client needs the whole set to draw a map. What reveals who holds
// what is /api/districts, which is scoped.
/* Boundary shapes only, no tenant data, so every role that opens the map may fetch them. It was
   MANAGE_ROLES, which left the map without polygons for the salesperson the nav sends there. */
const READERS = [...MANAGE_ROLES, "rep_manager", "phone_sales"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...READERS]);
  if (!guard.ok) return guard.response;

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
