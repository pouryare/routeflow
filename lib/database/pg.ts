/* The PostgreSQL side of the Db interface (Wave P, phase 2). Selected with DB_DIALECT=postgres
 * and DATABASE_URL; SQLite stays the default until the cut-over.
 *
 * App SQL is written once for both engines (lib/database/dialect.ts and the dialect guard
 * test), so this adapter only bridges what the drivers do differently:
 *   - `?` placeholders become `$1, $2...`;
 *   - a camelCase alias (`AS nameFa`, and every later use of it) is quoted, since PostgreSQL
 *     folds unquoted names to lower case and the row would come back as `namefa`;
 *   - an INSERT gets `RETURNING *`, so `lastInsertRowid` means what node:sqlite meant by it;
 *   - bigint and numeric come back as numbers, as node:sqlite returns them, not as strings,
 *     and a boolean comes back as 1 or 0, since SQLite has no booleans and the code reads those.
 *
 * tx() takes one pooled client for the whole transaction and carries it through
 * AsyncLocalStorage, so a function deep in the call chain that just calls getDb() joins it.
 * Statements outside a transaction use any pooled client: unlike SQLite there is no single
 * connection to protect, and PostgreSQL isolates the transactions itself. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import pg from "pg";
import type { Db, Row, Statement } from "./client";

pg.types.setTypeParser(20, (v) => Number(v)); // int8: COUNT, SUM of integers, ids
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric: SUM and AVG of bigint
pg.types.setTypeParser(16, (v) => (v === "t" ? 1 : 0)); // boolean: `x IS NOT NULL AS flag` reads 1 / 0 as in SQLite

/** `?` outside string literals and quoted names becomes `$n`; camelCase words are quoted. */
export function toPg(sql: string): string {
  let out = "";
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j;
    } else if (c === "?") out += `$${++n}`;
    else if (/[a-z]/.test(c) && !/[\w$]/.test(sql[i - 1] ?? "")) {
      // A camelCase word can only be an alias the code reads back by that name.
      const word = /^\w+/.exec(sql.slice(i))![0];
      out += /^[a-z][a-z0-9_]*[A-Z]\w*$/.test(word) ? `"${word}"` : word;
      i += word.length - 1;
    } else out += c;
  }
  return out;
}

/** `PRAGMA foreign_keys = OFF ... ON` is how test fixtures and maintenance scripts wipe tables
 *  in any order. PostgreSQL's equivalent is replica mode, which skips the foreign-key checks
 *  (and other triggers) for this session. Only meaningful inside one exec() or one tx(), since
 *  outside a transaction each call may get a different pooled connection. */
function foreignKeySwitch(sql: string): string {
  return sql.replace(/PRAGMA\s+foreign_keys\s*=\s*(OFF|ON)\s*;?/gi, (_, v: string) =>
    v.toUpperCase() === "OFF" ? "SET session_replication_role = replica;" : "SET session_replication_role = DEFAULT;"
  );
}

function withReturning(sql: string): string {
  if (!/^\s*INSERT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql.replace(/;\s*$/, "")} RETURNING *`;
}

type Queryable = Pick<pg.PoolClient, "query">;

/** One open transaction. SQLite undoes only the statement that failed and keeps the
 *  transaction going, and the app relies on it (try an insert, catch the duplicate, carry
 *  on). PostgreSQL aborts the whole transaction instead, so each statement runs inside a
 *  savepoint and a failure rolls back to it. Statements on the transaction run one at a time,
 *  so two awaited together cannot interleave their savepoints. */
class TxConn {
  private last: Promise<unknown> = Promise.resolve();
  private readonly client: pg.PoolClient;
  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  run(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    const next = this.last.then(async () => {
      await this.client.query("SAVEPOINT rf_stmt");
      try {
        const r = await this.client.query(text, params);
        await this.client.query("RELEASE SAVEPOINT rf_stmt");
        return r;
      } catch (e) {
        await this.client.query("ROLLBACK TO SAVEPOINT rf_stmt");
        throw e;
      }
    });
    this.last = next.catch(() => undefined);
    return next;
  }
}

/** The Db for one PostgreSQL database. `url` is a libpq connection string. */
export function pgDb(url: string, ready: () => Promise<void> = async () => {}): Db {
  let pool: pg.Pool | null = null;
  const txClient = new AsyncLocalStorage<TxConn>();
  const open = () => (pool ??= new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) }));
  const conn = async (): Promise<Queryable> => {
    await ready();
    return open();
  };
  const query = async (sql: string, params: unknown[]) => {
    const text = withReturning(toPg(sql));
    const inTx = txClient.getStore();
    return inTx ? inTx.run(text, params) : (await conn()).query(text, params);
  };

  return {
    prepare(sql: string): Statement {
      return {
        get: async (...params) => (await query(sql, params)).rows[0] as Row | undefined,
        all: async (...params) => (await query(sql, params)).rows as Row[],
        run: async (...params) => {
          const r = await query(sql, params);
          const id = (r.rows[r.rows.length - 1] as { id?: number } | undefined)?.id;
          return { changes: r.rowCount ?? 0, lastInsertRowid: id ?? 0 };
        },
      };
    },
    async exec(sql: string) {
      const text = foreignKeySwitch(sql);
      const inTx = txClient.getStore();
      if (inTx) await inTx.run(text);
      else await (await conn()).query(text);
    },
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      if (txClient.getStore()) return await fn();
      await ready();
      const client = await open().connect();
      try {
        await client.query("BEGIN");
        const out = await txClient.run(new TxConn(client), fn);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      const p = pool;
      pool = null;
      await p?.end();
    },
  };
}

/** For tests: when ROUTEFLOW_PG_TEMPLATE names a template database, each test file (one
 *  ROUTEFLOW_DB_PATH each) gets its own copy of it, as each got its own SQLite file. */
export function testDatabaseUrl(baseUrl: string, template: string, key: string): { url: string; ready: () => Promise<void> } {
  const name = `rf_t_${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  let made: Promise<void> | null = null;
  const ready = () =>
    (made ??= (async () => {
      const admin = new pg.Client({ connectionString: baseUrl });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
      } finally {
        await admin.end();
      }
    })());
  return { url: u.toString(), ready };
}
