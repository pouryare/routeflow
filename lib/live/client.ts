"use client";
/* Live updates in the browser (issue #58). A screen calls onLive("notifications", fn) and gets each
 * event for that topic as it happens.
 *
 * - One stream per browser, not per tab: the first tab to take the Web Lock "rf-live" holds the
 *   stream and passes every event to the other tabs over a BroadcastChannel. When it closes, the
 *   next tab takes the lock and the stream. A browser without either API opens one per tab.
 * - Closed when nobody is looking: every tab reports when it is visible, and the holder closes the
 *   stream after 2 minutes with no visible tab (a phone in a pocket stops using battery and a
 *   server connection). The next visible tab reopens it with `?after=` the last id seen, so
 *   nothing is lost.
 * - The browser's own EventSource reconnects by itself and sends Last-Event-ID; when it gives up
 *   (the server answered with an error), this tries again after 30 to 60 seconds. */
import { BYE_TOPIC, RESET_TOPIC } from "./protocol";

type Handler = (data: unknown) => void;

const HIDDEN_CLOSE_MS = 2 * 60_000;
const VISIBLE_PING_MS = 30_000;
const CHANNEL = "rf-live";

const handlers = new Map<string, Set<Handler>>();
const openHandlers = new Set<() => void>();
let started = false;
let lastId = 0;
let source: EventSource | null = null;
let leader = false;
let lastVisibleAt = Date.now();
let channel: BroadcastChannel | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

type Msg = { k: "ev"; t: string; d: unknown; id?: number } | { k: "open" } | { k: "visible" };

function dispatch(topic: string, data: unknown): void {
  for (const fn of handlers.get(topic) ?? []) {
    try {
      fn(data);
    } catch (e) {
      console.warn("[live] handler failed", e);
    }
  }
  // A reset means "events were missed": every screen refetches, exactly as after a reconnect.
  if (topic === RESET_TOPIC) for (const fn of openHandlers) fn();
}

function onFrame(e: MessageEvent<string>): void {
  let msg: { t?: unknown; d?: unknown };
  try {
    msg = JSON.parse(e.data);
  } catch {
    return;
  }
  if (typeof msg.t !== "string") return;
  if (e.lastEventId && /^\d+$/.test(e.lastEventId)) lastId = Math.max(lastId, Number(e.lastEventId));
  if (msg.t === BYE_TOPIC) {
    closeStream();
    scheduleRetry(60_000);
    return;
  }
  channel?.postMessage({ k: "ev", t: msg.t, d: msg.d, id: lastId } satisfies Msg);
  dispatch(msg.t, msg.d);
}

function openStream(): void {
  if (source || !leader) return;
  const es = new EventSource(lastId ? `/api/live?after=${lastId}` : "/api/live");
  source = es;
  es.onmessage = onFrame;
  es.onopen = () => {
    channel?.postMessage({ k: "open" } satisfies Msg);
    for (const fn of openHandlers) fn();
  };
  es.onerror = () => {
    // CONNECTING: the browser is already retrying by itself. CLOSED: it gave up (401, 429, 5xx).
    if (es.readyState === EventSource.CLOSED) {
      closeStream();
      scheduleRetry(30_000 + Math.random() * 30_000);
    }
  };
}

function closeStream(): void {
  source?.close();
  source = null;
}

function scheduleRetry(ms: number): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (Date.now() - lastVisibleAt < HIDDEN_CLOSE_MS) openStream();
  }, ms);
}

function seenVisible(): void {
  lastVisibleAt = Date.now();
  if (leader && !source && !retryTimer) openStream();
}

function start(): void {
  if (started || typeof window === "undefined" || typeof EventSource === "undefined") return;
  started = true;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.k === "ev") {
        if (m.id) lastId = Math.max(lastId, m.id); // so a tab that becomes the holder knows where to resume
        dispatch(m.t, m.d);
      } else if (m.k === "open") for (const fn of openHandlers) fn();
      else if (m.k === "visible") seenVisible();
    };
  }
  const ping = () => {
    if (document.visibilityState !== "visible") return;
    channel?.postMessage({ k: "visible" } satisfies Msg);
    seenVisible();
  };
  document.addEventListener("visibilitychange", ping);
  setInterval(ping, VISIBLE_PING_MS);
  setInterval(() => {
    if (source && Date.now() - lastVisibleAt > HIDDEN_CLOSE_MS) closeStream();
  }, 15_000);

  const lead = () => {
    leader = true;
    openStream();
  };
  if (channel && navigator.locks) {
    // Held until this tab closes; the next tab waiting on it then becomes the holder.
    void navigator.locks.request(CHANNEL, () => {
      lead();
      return new Promise<void>(() => {});
    });
  } else lead();
}

/** Calls `fn` with each event's data for this topic. Returns the way to stop. */
export function onLive(topic: string, fn: Handler): () => void {
  start();
  let set = handlers.get(topic);
  if (!set) handlers.set(topic, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

/** Calls `fn` whenever the stream (re)connects or reports a gap: the moment to refetch, since
 *  something may have changed while it was down. */
export function onLiveOpen(fn: () => void): () => void {
  start();
  openHandlers.add(fn);
  return () => openHandlers.delete(fn);
}
