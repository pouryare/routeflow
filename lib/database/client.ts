/* The asynchronous database handle the app talks to (Wave P, phase 1 of the PostgreSQL move).
 *
 * Every call returns a Promise, so code written against it does not change when the engine
 * underneath becomes PostgreSQL, whose driver can only answer asynchronously. Today the engine
 * is still node:sqlite: each method runs the synchronous statement and hands back a settled
 * Promise. The shape is deliberately the one the code already used -- prepare(sql) then
 * get / all / run -- so the move to it was "add await", not a rewrite of 1,200 statements.
 *
 * The boot-time schema, migrations, rebuilds and backfills in lib/database/ keep the raw
 * synchronous handle (rawSqlite in lib/db.ts). They only upgrade old SQLite files and are
 * replaced by one baseline schema on PostgreSQL. */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  DatabaseSync,
  SQLInputValue,
  SQLOutputValue,
  StatementResultingChanges,
  StatementSync,
} from "node:sqlite";

export type { SQLInputValue, SQLOutputValue, StatementResultingChanges };

export type Row = Record<string, SQLOutputValue>;

export interface Statement {
  get(...params: SQLInputValue[]): Promise<Row | undefined>;
  all(...params: SQLInputValue[]): Promise<Row[]>;
  run(...params: SQLInputValue[]): Promise<StatementResultingChanges>;
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  /** Runs `fn` in one transaction on this connection: every statement inside it, at any depth,
   *  commits together or not at all. A throw rolls back and rethrows. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /** Closes the connection; the next statement opens it again. Tests use it between suites. */
  close(): Promise<void>;
}

/* One transaction at a time, and only its own statements while it is open.
 *
 * node:sqlite has a single connection. While everything was synchronous nothing could run
 * between BEGIN and COMMIT; now that callers await, another request's statements could land
 * inside someone else's transaction and be committed -- or rolled back -- with it. So a
 * statement that is not part of the open transaction waits for it to finish, and the
 * transaction a statement belongs to is carried by AsyncLocalStorage, so a function deep in
 * the call chain that just calls getDb() still joins it. PostgreSQL gets a pooled client per
 * transaction instead, and the same tx() keeps its meaning there. */
interface OpenTx {
  id: number;
  done: Promise<void>;
}
const txScope = new AsyncLocalStorage<number>();
let openTx: OpenTx | null = null;
let txSeq = 0;

/** Runs `f` once boot is done and no other transaction is open. The last check and `f` run in
 *  the same synchronous step, so nothing can open a transaction in between. */
async function whenFree<T>(ready: () => Promise<void>, f: () => T): Promise<T> {
  await ready();
  while (openTx && txScope.getStore() !== openTx.id) await openTx.done;
  return f();
}

/** Runs `fn` in one transaction: every statement inside it, at any depth, commits together or
 *  not at all. A throw rolls back and rethrows. A tx() inside another one joins the outer. */
export async function tx<T>(
  raw: () => DatabaseSync,
  ready: () => Promise<void>,
  fn: () => Promise<T>
): Promise<T> {
  const current = txScope.getStore();
  if (current !== undefined && openTx?.id === current) return await fn();
  let release!: () => void;
  const me: OpenTx = { id: ++txSeq, done: new Promise<void>((r) => (release = r)) };
  await whenFree(ready, () => {
    openTx = me;
  });
  const db = raw();
  try {
    db.exec("BEGIN IMMEDIATE");
    const out = await txScope.run(me.id, fn);
    db.exec("COMMIT");
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  } finally {
    openTx = null;
    release();
  }
}

const noWait = async () => {};

/** Wraps the synchronous node:sqlite handle in the asynchronous interface. `ready` is awaited
 *  before every statement: the app's handle waits for the boot migrations, while the handle
 *  the migrations themselves use passes nothing. */
export function sqliteDb(
  raw: () => DatabaseSync,
  ready: () => Promise<void> = noWait,
  close: () => void = () => raw().close()
): Db {
  return {
    prepare(sql: string): Statement {
      // Prepared on first use and kept, so a statement prepared once and run in a loop is
      // compiled once, as it was before.
      let compiled: StatementSync | null = null;
      const stmt = () => (compiled ??= raw().prepare(sql));
      return {
        get: (...params) => whenFree(ready, () => stmt().get(...params) as Row | undefined),
        all: (...params) => whenFree(ready, () => stmt().all(...params) as Row[]),
        run: (...params) => whenFree(ready, () => stmt().run(...params)),
      };
    },
    exec: (sql: string) => whenFree(ready, () => raw().exec(sql)),
    tx: (fn) => tx(raw, ready, fn),
    async close() {
      // Opens first if need be, as closing the old synchronous handle did: a caller that
      // closes right after getDb() expects the boot migrations to have run.
      await ready();
      close();
    },
  };
}
