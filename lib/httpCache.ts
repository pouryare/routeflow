import { promisify } from "node:util";
import zlib from "node:zlib";
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

interface EncodedBodies {
  identity: Buffer;
  br: Buffer;
  gzip: Buffer;
}

// Next compresses the page/RSC pipeline but NOT route handlers, so everything here used
// to go out as raw UTF-8 -- and these payloads are mostly Persian text and ISO
// timestamps, which compress by better than 90%. Bodies are compressed once per ETag
// and reused, so a poll that does find new data pays for one compression and every
// other request pays nothing.
//
// Brotli quality 5, not the maximum 11: on this app's largest such payload q5 lands
// within ~800 bytes of q11 while taking 4ms instead of 300ms, and that cost is paid on
// the request that first observes a change.
const BROTLI_QUALITY = 5;
const MAX_CACHED_TAGS = 8;
const bodyCache = new Map<string, EncodedBodies>();

function encode(tag: string, data: unknown): EncodedBodies {
  const hit = bodyCache.get(tag);
  if (hit) return hit;

  const identity = Buffer.from(JSON.stringify(data), "utf8");
  const bodies: EncodedBodies = {
    identity,
    br: zlib.brotliCompressSync(identity, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    }),
    gzip: zlib.gzipSync(identity, { level: 6 }),
  };

  // Insertion-ordered eviction. Tags only turn over when the underlying table changes,
  // so this holds the current generation of every endpoint using these helpers with
  // room to spare.
  if (bodyCache.size >= MAX_CACHED_TAGS) {
    const oldest = bodyCache.keys().next().value;
    if (oldest !== undefined) bodyCache.delete(oldest);
  }
  bodyCache.set(tag, bodies);
  return bodies;
}

export function etagJson(req: NextRequest, tag: string, data: unknown): NextResponse {
  const bodies = encode(tag, data);
  const accepts = (req.headers.get("accept-encoding") ?? "").toLowerCase();

  let body = bodies.identity;
  let encoding: string | null = null;
  if (accepts.includes("br")) {
    body = bodies.br;
    encoding = "br";
  } else if (accepts.includes("gzip")) {
    body = bodies.gzip;
    encoding = "gzip";
  }

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    ETag: `W/"${tag}"`,
    "Cache-Control": "private, no-cache",
    Vary: "Accept-Encoding",
  });
  if (encoding) headers.set("Content-Encoding", encoding);

  return new NextResponse(new Uint8Array(body), { status: 200, headers });
}

const brotli = promisify(zlib.brotliCompress);
const gzipAsync = promisify(zlib.gzip);
/** Below this a body is sent as it is: the saving is smaller than the headers it adds. */
const COMPRESS_FROM_BYTES = 1024;

/** `NextResponse.json` that compresses itself. `next start` leaves route-handler JSON uncompressed (measured:
 *  /api/payments 4.6 MB instead of 277 KB), and Caddy's `encode` only helps once it is set up on the server, so
 *  the biggest list endpoints call this and do not depend on it. Brotli quality 4 (fast; see BROTLI_QUALITY for
 *  why not higher), done off the main thread. Use `etagJson` instead where a cheap change tag exists. */
export async function compressedJson(req: NextRequest, data: unknown, init: { status?: number; headers?: HeadersInit } = {}): Promise<NextResponse> {
  const identity = Buffer.from(JSON.stringify(data), "utf8");
  const accepts = (req.headers.get("accept-encoding") ?? "").toLowerCase();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.append("Vary", "Accept-Encoding");

  let body: Buffer = identity;
  if (identity.length >= COMPRESS_FROM_BYTES && (accepts.includes("br") || accepts.includes("gzip"))) {
    if (accepts.includes("br")) {
      body = await brotli(identity, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
      headers.set("Content-Encoding", "br");
    } else {
      body = await gzipAsync(identity, { level: 6 });
      headers.set("Content-Encoding", "gzip");
    }
  }
  headers.set("Content-Length", String(body.length));
  return new NextResponse(new Uint8Array(body), { status: init.status ?? 200, headers });
}
