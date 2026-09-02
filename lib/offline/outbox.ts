/** The pure heart of the offline queue.
 *
 *  Storage is injected (`OutboxStore`) so the ordering, hold, dependency and idempotency
 *  logic is testable in Node; the IndexedDB implementation (lib/offline/idbStore.ts) is
 *  a thin adapter over this contract.
 *
 *  A record is born `held`. While held, `undo` is a local delete -- instant, no round
 *  trip, identical offline. After OUTBOX_HOLD_MS it becomes `pending` and the sync
 *  engine may send it. A dependency (a door payment against an order created offline)
 *  keeps a record out of `nextBatch` until the thing it depends on is `applied`.
 */

import { uuidv7 } from "./uuidv7";
import { mayQueueOffline, type OfflineOp } from "./safety";
import { OUTBOX_HOLD_MS, RETRY_BASE_MS, RETRY_CAP_MS, MAX_ATTEMPTS } from "./constants";

export class OfflineError extends Error {}

export type OutboxStatus =
  | "held"
  | "pending"
  | "sending"
  | "applied"
  | "conflict"
  | "failed";

export interface OutboxRecord {
  id: string; // uuidv7 -- this is the client_uuid
  op: OfflineOp;
  payload: Record<string, unknown>;
  occurred_at: string;
  clock_skew_ms: number;
  queued_at: string;
  attempts: number;
  status: OutboxStatus;
  depends_on?: string[];
  error?: string;
  /** epoch ms before which the engine should not retry a `failed` record */
  retry_after?: number;
}

export interface OutboxStore {
  all(): Promise<OutboxRecord[]>;
  get(id: string): Promise<OutboxRecord | undefined>;
  put(r: OutboxRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export type MutationResult =
  | { status: "applied"; server_id: number | null }
  | { status: "duplicate"; server_id: number | null }
  | { status: "conflict"; reason: string }
  | { status: "failed"; error: string };

export class Outbox {
  private store: OutboxStore;
  private now: () => number;

  constructor(store: OutboxStore, now: () => number = () => Date.now()) {
    this.store = store;
    this.now = now;
  }

  /** Queue a fact. Refuses a claim before writing anything -- a claim is never
   *  queue-then-rejected, it is refused where it is made. */
  async enqueue(
    op: OfflineOp,
    payload: Record<string, unknown>,
    opts: { depends_on?: string[]; occurred_at?: string; clock_skew_ms?: number } = {}
  ): Promise<OutboxRecord> {
    if (!mayQueueOffline(op)) {
      throw new OfflineError("این کار به اینترنت نیاز دارد و صف نمی‌شود");
    }
    const t = this.now();
    const rec: OutboxRecord = {
      id: uuidv7(t),
      op,
      payload,
      occurred_at: opts.occurred_at ?? new Date(t).toISOString(),
      clock_skew_ms: opts.clock_skew_ms ?? 0,
      queued_at: new Date(t).toISOString(),
      attempts: 0,
      status: "held",
      depends_on: opts.depends_on,
    };
    await this.store.put(rec);
    return rec;
  }

  /** `held` -> `pending` once the hold time has passed. Returns how many were released. */
  async releaseHeld(): Promise<number> {
    const t = this.now();
    let n = 0;
    for (const r of await this.store.all()) {
      if (r.status === "held" && t - Date.parse(r.queued_at) >= OUTBOX_HOLD_MS) {
        await this.store.put({ ...r, status: "pending" });
        n += 1;
      }
    }
    return n;
  }

  /** Take back a still-held mutation: a local delete. Returns false if it is past the
   *  hold and already on its way. */
  async undo(id: string): Promise<boolean> {
    const r = await this.store.get(id);
    if (!r || r.status !== "held") return false;
    await this.store.remove(id);
    return true;
  }

  /** The next records to send: `pending` only, dependency-ordered, and only when every
   *  dependency is already `applied`. A `failed` record whose backoff has not elapsed is
   *  skipped. */
  async nextBatch(limit = 20): Promise<OutboxRecord[]> {
    const all = await this.store.all();
    const byId = new Map(all.map((r) => [r.id, r]));
    const applied = new Set(all.filter((r) => r.status === "applied").map((r) => r.id));
    const t = this.now();

    const ready = all.filter((r) => {
      if (r.status === "pending") {
        return (r.depends_on ?? []).every((d) => applied.has(d));
      }
      if (r.status === "failed") {
        return (
          (r.retry_after ?? 0) <= t &&
          r.attempts < MAX_ATTEMPTS &&
          (r.depends_on ?? []).every((d) => applied.has(d) || byId.has(d))
        );
      }
      return false;
    });

    // Stable causal order: uuidv7 ids already sort by queue time; a record still comes
    // after any dependency present in this batch.
    ready.sort((a, b) => (a.id < b.id ? -1 : 1));
    const picked: OutboxRecord[] = [];
    const inBatch = new Set<string>();
    for (const r of ready) {
      if (picked.length >= limit) break;
      const depsSatisfied = (r.depends_on ?? []).every(
        (d) => applied.has(d) || inBatch.has(d)
      );
      if (!depsSatisfied) continue;
      picked.push(r);
      inBatch.add(r.id);
    }
    return picked;
  }

  async markSending(ids: string[]): Promise<void> {
    for (const id of ids) {
      const r = await this.store.get(id);
      if (r) await this.store.put({ ...r, status: "sending" });
    }
  }

  /** Fold the server's per-mutation verdicts back into the queue. */
  async applyResults(results: Record<string, MutationResult>): Promise<void> {
    const t = this.now();
    for (const [id, res] of Object.entries(results)) {
      const r = await this.store.get(id);
      if (!r) continue;
      if (res.status === "applied" || res.status === "duplicate") {
        await this.store.put({ ...r, status: "applied", error: undefined });
      } else if (res.status === "conflict") {
        await this.store.put({ ...r, status: "conflict", error: res.reason });
      } else {
        const attempts = r.attempts + 1;
        const backoff = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_CAP_MS);
        await this.store.put({
          ...r,
          status: "failed",
          attempts,
          error: res.error,
          retry_after: t + backoff,
        });
      }
    }
  }

  /** Everything still in flight -- what the sync-status island counts. */
  async pendingCount(): Promise<number> {
    const all = await this.store.all();
    return all.filter(
      (r) => r.status === "held" || r.status === "pending" || r.status === "sending"
    ).length;
  }

  async list(): Promise<OutboxRecord[]> {
    return (await this.store.all()).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}

/** An OutboxStore backed by a plain Map -- the fallback when IndexedDB is unavailable,
 *  and what the tests use. */
export class MemoryOutboxStore implements OutboxStore {
  private m = new Map<string, OutboxRecord>();
  async all() {
    return [...this.m.values()].map((r) => ({ ...r }));
  }
  async get(id: string) {
    const r = this.m.get(id);
    return r ? { ...r } : undefined;
  }
  async put(r: OutboxRecord) {
    this.m.set(r.id, { ...r });
  }
  async remove(id: string) {
    this.m.delete(id);
  }
}
