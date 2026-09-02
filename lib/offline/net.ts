/** Fetch wrappers that (a) re-measure clock skew from every `server_time` a sync
 *  response carries, and (b) divert an offline write on an allowlisted endpoint into the
 *  outbox instead of failing.
 *
 *  Browser code -- not unit-tested. The pure pieces it leans on (Outbox, measureSkew)
 *  are.
 */

import { Outbox } from "./outbox";
import type { OfflineOp } from "./safety";
import { measureSkew } from "./clock";

let skewMs = 0;
export function currentSkew(): number {
  return skewMs;
}
export function noteServerTime(serverIso: string | undefined): void {
  if (serverIso) skewMs = measureSkew(serverIso, Date.now());
}

/** Endpoints whose POST body maps cleanly onto an offline op. `/api/sync/push` is NOT
 *  here -- it is the drain, never queued. */
const OFFLINE_ENDPOINTS: { test: RegExp; op: OfflineOp }[] = [
  { test: /\/api\/sales\/deliveries\/\d+\/complete$/, op: "delivery.complete" },
  { test: /\/api\/payments$/, op: "payment.record" },
];

function matchOfflineOp(url: string): OfflineOp | null {
  for (const e of OFFLINE_ENDPOINTS) if (e.test.test(url)) return e.op;
  return null;
}

export interface PostResult<T = unknown> {
  ok: boolean;
  status: number;
  queued?: boolean;
  client_uuid?: string;
  data?: T;
}

/** POST JSON. If the device is offline and the URL is an offline endpoint, enqueue and
 *  return `{queued:true}` with the freshly-minted client_uuid (the undo target). */
export async function postJSON<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  outbox?: Outbox
): Promise<PostResult<T>> {
  const op = matchOfflineOp(url);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (offline && op && outbox) {
    const rec = await outbox.enqueue(op, body, { clock_skew_ms: skewMs });
    return { ok: true, status: 202, queued: true, client_uuid: rec.id };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { server_time?: string };
  noteServerTime((data as { server_time?: string }).server_time);
  return { ok: res.ok, status: res.status, data };
}

export async function getJSON<T = unknown>(url: string): Promise<{ ok: boolean; status: number; data?: T }> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & { server_time?: string };
  noteServerTime((data as { server_time?: string }).server_time);
  return { ok: res.ok, status: res.status, data };
}
