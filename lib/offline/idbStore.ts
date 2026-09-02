/** IndexedDB implementation of OutboxStore, plus a `snapshot` store for the reads a
 *  driver needs to work offline (today's run, its customers, products, prices).
 *
 *  Browser code -- not unit-tested (this repo has no browser test harness). Every
 *  accessor is wrapped: a private window, a browser with site data blocked, or a
 *  thumbnail/preview context can all make IndexedDB throw or return nothing, and the app
 *  must still run. When that happens this falls back to an in-memory Map -- the queue
 *  works for the session, it just does not survive a reload.
 */

import type { OutboxRecord, OutboxStore } from "./outbox";
import { MemoryOutboxStore } from "./outbox";

const DB_NAME = "routeflow-offline";
const DB_VERSION = 1;
const OUTBOX = "outbox";
const SNAPSHOT = "snapshot";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SNAPSHOT))
        db.createObjectStore(SNAPSHOT, { keyPath: ["table", "id"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbOutboxStore implements OutboxStore {
  private dbP: Promise<IDBDatabase> | null = null;
  private mem = new MemoryOutboxStore();
  /** True once any IndexedDB op has failed -- from then on this is memory-only. */
  memoryOnly = false;

  private async db(): Promise<IDBDatabase | null> {
    if (this.memoryOnly) return null;
    try {
      if (!this.dbP) this.dbP = openDb();
      return await this.dbP;
    } catch {
      this.memoryOnly = true;
      return null;
    }
  }

  async all(): Promise<OutboxRecord[]> {
    const db = await this.db();
    if (!db) return this.mem.all();
    try {
      return (await tx<OutboxRecord[]>(db, OUTBOX, "readonly", (s) => s.getAll())) ?? [];
    } catch {
      this.memoryOnly = true;
      return this.mem.all();
    }
  }

  async get(id: string): Promise<OutboxRecord | undefined> {
    const db = await this.db();
    if (!db) return this.mem.get(id);
    try {
      return await tx<OutboxRecord | undefined>(db, OUTBOX, "readonly", (s) => s.get(id));
    } catch {
      this.memoryOnly = true;
      return this.mem.get(id);
    }
  }

  async put(r: OutboxRecord): Promise<void> {
    await this.mem.put(r); // keep the mirror warm in case IDB dies mid-session
    const db = await this.db();
    if (!db) return;
    try {
      await tx(db, OUTBOX, "readwrite", (s) => s.put(r));
    } catch {
      this.memoryOnly = true;
    }
  }

  async remove(id: string): Promise<void> {
    await this.mem.remove(id);
    const db = await this.db();
    if (!db) return;
    try {
      await tx(db, OUTBOX, "readwrite", (s) => s.delete(id));
    } catch {
      this.memoryOnly = true;
    }
  }

  /** Replace the snapshot rows for a table-batch from a pull. */
  async writeSnapshot(rows: { table: string; row: { id?: unknown } & Record<string, unknown> }[]): Promise<void> {
    const db = await this.db();
    if (!db) return;
    try {
      for (const { table, row } of rows) {
        if (row.id === undefined) continue;
        await tx(db, SNAPSHOT, "readwrite", (s) => s.put({ table, id: row.id, row }));
      }
    } catch {
      this.memoryOnly = true;
    }
  }

  async readSnapshot(table: string): Promise<Record<string, unknown>[]> {
    const db = await this.db();
    if (!db) return [];
    try {
      const all = (await tx<{ table: string; row: Record<string, unknown> }[]>(
        db,
        SNAPSHOT,
        "readonly",
        (s) => s.getAll()
      )) ?? [];
      return all.filter((r) => r.table === table).map((r) => r.row);
    } catch {
      this.memoryOnly = true;
      return [];
    }
  }
}
