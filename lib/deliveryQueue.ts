/** A queue for deliveries recorded with no signal.
 *
 *  This is the app's first offline *write* path. The service worker has always cached
 *  reads and deliberately never queued writes; a driver standing in a shop with no bars
 *  is the case that forces the change, because the alternative is losing the record of
 *  a delivery that has already happened.
 *
 *  It leans on a property of the endpoint rather than on bookkeeping: recording a
 *  delivery is a set of assignments, not increments, so sending the same one twice
 *  leaves the same state. That means a request whose response never arrived can simply
 *  be sent again, and the queue needs no server-side dedupe table -- only a list of what
 *  has not been acknowledged yet.
 *
 *  localStorage rather than IndexedDB on purpose: the payloads are a few hundred bytes
 *  each and a round has a few dozen stops, so the simpler store is the right size for
 *  the job and has no upgrade path to get wrong.
 */

const KEY = "delivery-queue-v1";

export interface QueuedDelivery {
  stopId: number;
  body: unknown;
  /** When it was recorded, not when it was sent -- this is what the driver actually did. */
  recordedAt: string;
}

function read(): QueuedDelivery[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unavailable. An empty queue is the safe reading: it means "nothing
    // pending", which at worst loses a retry the driver can repeat.
    return [];
  }
}

const listeners = new Set<() => void>();

/** Subscription for useSyncExternalStore.
 *
 *  The queue is the external system that hook exists for: it lives in localStorage,
 *  changes outside React, and a component needs to render its size. Reading it in an
 *  effect and calling setState instead costs a second render pass on a screen used at a
 *  doorstep, and React's own lint rule says as much.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(items: QueuedDelivery[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Full or disabled. Nothing useful to do here, and throwing would break the very
    // screen the driver needs.
  }
  // Notified even when the write failed: a reader wants the current state, and after a
  // failed write that is whatever is still stored.
  for (const listener of listeners) listener();
}

export function queueSize(): number {
  return read().length;
}

export function enqueue(item: QueuedDelivery): void {
  const items = read();
  // One entry per stop. A driver correcting what they typed before it sends should
  // replace the pending record, not stack a second one behind it.
  write([...items.filter((i) => i.stopId !== item.stopId), item]);
}

export function dequeue(stopId: number): void {
  write(read().filter((i) => i.stopId !== stopId));
}

export type SendResult = { sent: number; failed: number };

/** Tries to send everything pending, oldest first.
 *
 *  A 4xx is dropped rather than retried: the server refused the content, and replaying
 *  it forever would block every later delivery behind one bad record. A network error
 *  or a 5xx stays queued, because those are the ones that succeed on the next try.
 */
export async function flush(
  send: (stopId: number, body: unknown) => Promise<Response>
): Promise<SendResult> {
  const items = read();
  let sent = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const res = await send(item.stopId, item.body);
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        dequeue(item.stopId);
        if (res.ok) sent++;
        else failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { sent, failed };
}

/** The one request that records a delivery. The flow, the retry on reconnect and the queue
 *  flush all send through here, so they cannot drift apart. */
export function sendDelivery(stopId: number, body: unknown): Promise<Response> {
  return fetch(`/api/driver/stops/${stopId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
