/** The sync engine: wakes on the usual triggers, drains the outbox to /api/sync/push,
 *  folds the results back, then pulls /api/sync/pull and writes the snapshot.
 *
 *  Browser glue -- not unit-tested. Every moving part it relies on (Outbox ordering,
 *  applyResults, uuidv7, clock) is pure and covered.
 */

import { Outbox } from "./outbox";
import type { MutationResult } from "./outbox";
import { IdbOutboxStore } from "./idbStore";
import { noteServerTime } from "./net";
import { snapshotDeletes } from "./snapshotDeletes";
import { SYNC_INTERVAL_MS } from "./constants";

interface PushResponse {
  ok: boolean;
  results: Record<string, MutationResult>;
  server_time: string;
}
interface PullResponse {
  ok: boolean;
  rows: { table: string; row: Record<string, unknown> }[];
  tombstones: { entity_type: string; entity_id: number }[];
  watermark: string;
  server_time: string;
}

const WATERMARK_KEY = "routeflow.sync.watermark";
const LAST_SYNC_KEY = "routeflow.sync.last";

export class SyncEngine extends EventTarget {
  readonly store = new IdbOutboxStore();
  readonly outbox = new Outbox(this.store);
  private timer: number | null = null;
  private running = false;
  deviceId = "";

  constructor() {
    super();
    try {
      this.deviceId =
        localStorage.getItem("routeflow.device") ??
        (() => {
          const d = crypto.randomUUID();
          localStorage.setItem("routeflow.device", d);
          return d;
        })();
    } catch {
      this.deviceId = "ephemeral";
    }
  }

  start(): void {
    const kick = () => void this.runCycle();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") kick();
    });
    navigator.serviceWorker?.addEventListener?.("message", (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "flush") kick();
    });
    this.timer = window.setInterval(() => {
      if (navigator.onLine) kick();
    }, SYNC_INTERVAL_MS);
    /* The first cycle waits for the page's own files and an idle moment: started at hydration it
       competed with the first screen's lazy chunks and fonts on a slow line. Later cycles and the
       online / visible kicks are unchanged. Safari has no requestIdleCallback, hence the timer. */
    const first = () => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(kick, { timeout: 4000 });
      else setTimeout(kick, 1500);
    };
    if (document.readyState === "complete") first();
    else window.addEventListener("load", first, { once: true });
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private emitChange(): void {
    this.dispatchEvent(new Event("change"));
  }

  async runCycle(): Promise<void> {
    if (this.running || !navigator.onLine) return;
    this.running = true;
    try {
      await this.outbox.releaseHeld();
      const batch = await this.outbox.nextBatch();
      if (batch.length > 0) {
        await this.outbox.markSending(batch.map((r) => r.id));
        const res = await fetch("/api/sync/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_id: this.deviceId,
            mutations: batch.map((r) => ({
              client_uuid: r.id,
              op: r.op,
              payload: r.payload,
              occurred_at: r.occurred_at,
              clock_skew_ms: r.clock_skew_ms,
              depends_on: r.depends_on,
            })),
          }),
        });
        if (res.ok) {
          const j = (await res.json()) as PushResponse;
          noteServerTime(j.server_time);
          await this.outbox.applyResults(j.results);
        } else {
          // leave them `sending` -> a later cycle re-picks after markSending timeout;
          // simplest safe behaviour is to flip them back to pending.
          for (const r of batch) await this.store.put({ ...r, status: "pending" });
        }
      }

      // pull
      let since: string | null = null;
      try {
        since = localStorage.getItem(WATERMARK_KEY);
      } catch {
        /* ignore */
      }
      const pres = await fetch(`/api/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ""}`);
      if (pres.ok) {
        const j = (await pres.json()) as PullResponse;
        noteServerTime(j.server_time);
        await this.store.deleteSnapshot(snapshotDeletes(j.tombstones ?? [], j.rows));
        await this.store.writeSnapshot(
          j.rows.filter((r) => (r.row as { id?: unknown }).id !== undefined) as never
        );
        try {
          localStorage.setItem(WATERMARK_KEY, j.watermark);
          localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
        } catch {
          /* ignore */
        }
      }
    } finally {
      this.running = false;
      this.emitChange();
    }
  }

  lastSyncedAt(): string | null {
    try {
      return localStorage.getItem(LAST_SYNC_KEY);
    } catch {
      return null;
    }
  }
}

let singleton: SyncEngine | null = null;
export function getSyncEngine(): SyncEngine {
  if (!singleton) singleton = new SyncEngine();
  return singleton;
}
