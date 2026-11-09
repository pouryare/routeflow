import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getSession, getSessionFromCookies, type Session } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { liveHub } from "@/lib/live/hub";
import { canSeeRecord } from "@/lib/live/visibility";
import { lastSeenId, parseTagFilter, retryMs, type LiveFilter, type LiveListener } from "@/lib/live/protocol";
import { withDbScope } from "@/lib/database/scope";
import { displayKey } from "@/lib/repo/liveDisplay";

export const dynamic = "force-dynamic";

const listener = (s: Session): LiveListener => ({ userId: s.user.id, organizationId: s.organizationId, roles: s.roles });

/* A stream's write buffer may fall this far behind before the phone is judged too slow and the
   stream is closed; it reconnects and catches up from the log instead of holding server memory. */
const SLOW_BYTES = 256 * 1024;

/** The live stream (issue #58): one per browser, carrying every topic. See lib/live/hub.ts.
 *
 *  Every signed-in person may open it, and so may a screen holding a display link (?display=);
 *  what reaches them is decided per event by its company and
 *  audience. The headers keep proxies from caching, compressing or holding it back (Caddy's encode
 *  is switched off for this path as well, deploy/routeflow). */
/** One stream's identity and checks, for a signed-in person or for a display link. */
interface Opened {
  who: LiveListener;
  filter?: LiveFilter;
  recheck(): Promise<LiveListener | null>;
  canSee(type: string, id: number): Promise<boolean>;
}

const tooMany = (retryAfterSeconds: number) =>
  NextResponse.json(
    { ok: false, error: "درخواست‌های زیاد؛ کمی بعد دوباره وصل می‌شود" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );

/** A display link (idea L9): no session, held to the key's topics. Its listener id is minus the
 *  key's id, so it never matches a person's audience, is never marked online, and a revoke's kick
 *  finds it. Record events of its topics reach it: the owner chose those topics for that screen,
 *  and such an event is only an id and a status. Anything aimed at people or roles never does. */
async function openDisplay(key: string): Promise<Opened | NextResponse> {
  const k = await withDbScope("system", () => displayKey(key));
  if (!k) return NextResponse.json({ ok: false, error: "این پیوند معتبر نیست یا لغو شده است" }, { status: 401 });
  const limit = rateLimit(`live:display:${k.id}`, 30, 60_000);
  if (!limit.allowed) return tooMany(limit.retryAfterSeconds);
  const who: LiveListener = { userId: -k.id, organizationId: k.organizationId, roles: [] };
  return {
    who,
    filter: { topics: k.topics },
    recheck: async () => ((await withDbScope("system", () => displayKey(key))) ? who : null),
    canSee: async () => true,
  };
}

export async function GET(req: NextRequest) {
  const display = req.nextUrl.searchParams.get("display");
  let opened: Opened;
  if (display) {
    const d = await openDisplay(display);
    if (d instanceof NextResponse) return d;
    opened = d;
  } else {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
    const limit = rateLimit(`live:${session.user.id}`, 30, 60_000);
    if (!limit.allowed) return tooMany(limit.retryAfterSeconds);
    const token = req.cookies.get(COOKIE_NAME)?.value;
    let current = session; // replaced when the session is read again
    // ?tags=district:14 sends only events labelled for district 14, and those with no district
    // label (idea L10). It narrows what the person may receive; it never widens it.
    const tags = parseTagFilter(req.nextUrl.searchParams.get("tags"));
    opened = {
      who: listener(session),
      filter: tags ? { tags } : undefined,
      async recheck() {
        const s = await getSessionFromCookies(token);
        if (s) current = s;
        return s ? listener(s) : null;
      },
      canSee: (type, id) => canSeeRecord(current, type, id),
    };
  }
  const lastSeen = lastSeenId(req.headers.get("last-event-id"), req.nextUrl.searchParams.get("after"));
  const encoder = new TextEncoder();
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
              ...opened,
              write(chunk) {
                if (closed) return false;
                controller.enqueue(encoder.encode(chunk));
                return (controller.desiredSize ?? 0) > -SLOW_BYTES;
              },
              close,
              behind: () => (controller.desiredSize ?? 0) <= 0,
              device: req.headers.get("user-agent"),
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
