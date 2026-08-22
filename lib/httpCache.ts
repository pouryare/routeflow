import { NextRequest, NextResponse } from "next/server";

// Weak-ETag helpers for read endpoints backed by frequently-polled-but-rarely-changed
// tables. The tag is built from a cheap COUNT + MAX(updated_at) query, not a hash of
// the full payload, and must change the instant the underlying rows do -- callers
// check it *before* running the real query, so a 304 skips the row fetch entirely,
// not just the network transfer.
//
// Cache-Control is always "no-cache" (always revalidate), never a timed max-age --
// this endpoint backs UI that must reflect a write immediately, so nothing here may
// let the browser skip asking the server at all.

export function etagFor(scope: string, count: number, maxUpdatedAt: string | null): string {
  return `${scope}-${count}-${maxUpdatedAt}`;
}

export function notModified(req: NextRequest, tag: string): NextResponse | null {
  if (req.headers.get("if-none-match") !== `W/"${tag}"`) return null;
  return new NextResponse(null, {
    status: 304,
    headers: { ETag: `W/"${tag}"`, "Cache-Control": "private, no-cache" },
  });
}

export function etagJson(tag: string, data: unknown): NextResponse {
  const res = NextResponse.json(data);
  res.headers.set("ETag", `W/"${tag}"`);
  res.headers.set("Cache-Control", "private, no-cache");
  return res;
}
