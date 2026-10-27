/* The asynchronous database handle the app talks to. PostgreSQL is the only engine (lib/database/pg.ts
 * implements it); the shape is the one the code was written against on SQLite -- prepare(sql), then
 * get / all / run -- with `?` placeholders that the adapter turns into $1, $2, ... */

type SqlValue = null | number | bigint | string | Uint8Array | boolean;
export type Row = Record<string, unknown>;

interface RunResult {
  changes: number | bigint;
  /** The id column of the last row an INSERT returned; 0 when the statement returns none. */
  lastInsertRowid: number | bigint;
}

export interface Statement {
  get(...params: SqlValue[]): Promise<Row | undefined>;
  all(...params: SqlValue[]): Promise<Row[]>;
  run(...params: SqlValue[]): Promise<RunResult>;
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  /** Runs `fn` in one transaction on this connection: every statement inside it, at any depth,
   *  commits together or not at all. A throw rolls back and rethrows. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /** Closes the connection pool; the next statement opens it again. Tests use it between suites. */
  close(): Promise<void>;
}
