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

/** Many writes in ONE transaction: resolves when it commits, rejects if it aborts. */
function txBatch(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    fn(t.objectStore(store));
  });
}

/** Rows per transaction, and a pause between transactions so a tap during a big sync is answered.
 *  A transaction per row cost an owner's phone a ~1 s freeze for 900 rows on a slow CPU. */
const WRITE_GROUP = 200;
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

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
      const usable = rows.filter((r) => r.row.id !== undefined);
      for (let i = 0; i < usable.length; i += WRITE_GROUP) {
        const group = usable.slice(i, i + WRITE_GROUP);
        await txBatch(db, SNAPSHOT, (s) => {
          for (const { table, row } of group) s.put({ table, id: row.id, row });
        });
        if (i + WRITE_GROUP < usable.length) await breathe();
      }
    } catch {
      this.memoryOnly = true;
    }
  }

  /** Drop snapshot rows the server deleted (keys from `snapshotDeletes`). */
  async deleteSnapshot(keys: readonly (readonly [string, number])[]): Promise<void> {
    if (keys.length === 0) return;
    const db = await this.db();
    if (!db) return;
    try {
      for (let i = 0; i < keys.length; i += WRITE_GROUP) {
        const group = keys.slice(i, i + WRITE_GROUP);
        await txBatch(db, SNAPSHOT, (s) => {
          for (const [table, id] of group) s.delete([table, id]);
        });
        if (i + WRITE_GROUP < keys.length) await breathe();
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
