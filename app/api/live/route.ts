import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getSession, getSessionFromCookies, type Session } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { liveHub } from "@/lib/live/hub";
import { canSeeRecord } from "@/lib/live/visibility";
import { lastSeenId, retryMs, type LiveListener } from "@/lib/live/protocol";

export const dynamic = "force-dynamic";

const listener = (s: Session): LiveListener => ({ userId: s.user.id, organizationId: s.organizationId, roles: s.roles });

/* A stream's write buffer may fall this far behind before the phone is judged too slow and the
   stream is closed; it reconnects and catches up from the log instead of holding server memory. */
const SLOW_BYTES = 256 * 1024;

/** The live stream (issue #58): one per browser, carrying every topic. See lib/live/hub.ts.
 *
 *  Every signed-in person may open it; what reaches them is decided per event by its company and
 *  audience. The headers keep proxies from caching, compressing or holding it back (Caddy's encode
 *  is switched off for this path as well, deploy/routeflow). */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  const limit = rateLimit(`live:${session.user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "درخواست‌های زیاد؛ کمی بعد دوباره وصل می‌شود" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const lastSeen = lastSeenId(req.headers.get("last-event-id"), req.nextUrl.searchParams.get("after"));
  const encoder = new TextEncoder();
  let current = session; // replaced when the session is read again
  let leave: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* the browser already went */
          }
        };
        // Opens the stream at once, so neither Caddy nor the CDN waits for a first event.
        controller.enqueue(encoder.encode(`retry: ${retryMs()}\n: ok\n\n`));
        try {
          leave = await liveHub.add(
            {
              who: listener(session),
              write(chunk) {
                if (closed) return false;
                controller.enqueue(encoder.encode(chunk));
                return (controller.desiredSize ?? 0) > -SLOW_BYTES;
              },
              close,
              behind: () => (controller.desiredSize ?? 0) <= 0,
              async recheck() {
                const s = await getSessionFromCookies(token);
                if (s) current = s;
                return s ? listener(s) : null;
              },
              canSee: (type, id) => canSeeRecord(current, type, id),
            },
            lastSeen
          );
        } catch (e) {
          console.warn("[live] stream could not start", e);
          close();
          return;
        }
        if (closed || req.signal.aborted) leave();
        req.signal.addEventListener("abort", () => leave?.());
      },
      cancel() {
        closed = true;
        leave?.();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 })
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
