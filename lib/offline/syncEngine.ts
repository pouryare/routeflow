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
  /** Where the next page starts; absent or null on the last page. */
  next?: string | null;
  server_time: string;
}

const WATERMARK_KEY = "routeflow.sync.watermark";
const PROGRESS_KEY = "routeflow.sync.progress";
const PULL_PAGE = 1500;
const MAX_PULL_PAGES = 200;

interface PullProgress {
  since: string | null;
  at: string;
  after: string;
}
/** Where an interrupted pull stopped, if it was a pull from the same watermark we are about to ask from. */
function readProgress(since: string | null): PullProgress | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null") as PullProgress | null;
    return p && p.since === since && typeof p.at === "string" && typeof p.after === "string" ? p : null;
  } catch {
    return null;
  }
}
function saveProgress(p: PullProgress | null): void {
  try {
    if (p) localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}
const LAST_SYNC_KEY = "routeflow.sync.last";

/** Records not yet accepted by the server: held, queued, sending, refused or in conflict. Only an
 *  applied one is safe to lose with the local copy. */
export const unsentCount = (records: readonly { status: string }[]): number => records.filter((r) => r.status !== "applied").length;

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
      // The pull comes in pages of PULL_PAGE rows (issue #60, G). Each page is written as it arrives and the
      // place reached is kept, so a line that drops at 80% resumes at 80%; the watermark is saved only after
      // the last page, and it is the first page's, so nothing changed meanwhile is lost.
      let progress = readProgress(since);
      for (let guard = 0; guard < MAX_PULL_PAGES; guard++) {
        const q = new URLSearchParams({ limit: String(PULL_PAGE) });
        if (since) q.set("since", since);
        if (progress) {
          q.set("after", progress.after);
          q.set("at", progress.at);
        }
        const pres = await fetch(`/api/sync/pull?${q}`);
        if (!pres.ok) break;
        const j = (await pres.json()) as PullResponse;
        noteServerTime(j.server_time);
        await this.store.deleteSnapshot(snapshotDeletes(j.tombstones ?? [], j.rows));
        await this.store.writeSnapshot(
          j.rows.filter((r) => (r.row as { id?: unknown }).id !== undefined) as never
        );
        if (j.next) {
          progress = { since, at: j.watermark, after: j.next };
          saveProgress(progress);
          continue;
        }
        try {
          localStorage.setItem(WATERMARK_KEY, j.watermark);
          localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
        } catch {
          /* ignore */
        }
        saveProgress(null);
        break;
      }
    } finally {
      this.running = false;
      this.emitChange();
    }
  }

  /** Z19 safe refresh: refuse while anything still waits to be sent (returns how many), otherwise
   *  clear the phone's copy and the pull watermark so the next pull fetches everything again. */
  async clearLocalCopy(): Promise<{ ok: true } | { ok: false; unsent: number }> {
    const unsent = unsentCount(await this.outbox.list());
    if (unsent > 0) return { ok: false, unsent };
    await this.store.clearSnapshot();
    try {
      localStorage.removeItem(WATERMARK_KEY);
      localStorage.removeItem(LAST_SYNC_KEY);
      localStorage.removeItem(PROGRESS_KEY);
    } catch {
      /* the watermark could not be read either */
    }
    return { ok: true };
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
