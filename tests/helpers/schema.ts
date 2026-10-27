/* Reading the live schema from the PostgreSQL catalog, for the schema tests.
 *
 * The helpers return the shapes and type names the tests were first written against (PRAGMA
 * table_info's columns, INTEGER / REAL / TEXT / BLOB), so a test that asks "does customers have
 * opening_balance_toman, NOT NULL, INTEGER?" still reads the same. */
import type { Db } from "@/lib/database/client";

/* lib/db is imported when first asked for, never at the top: a test sets ROUTEFLOW_DB_PATH
   before it imports lib/db, and a static import here would be hoisted above that. */
const db = async (): Promise<Db> => (await import("@/lib/db")).getDb();

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const SQLITE_TYPE: Record<string, string> = { bigint: "INTEGER", "double precision": "REAL", text: "TEXT", bytea: "BLOB" };

/** PRAGMA table_info(table), read from the catalog. */
export async function tableInfo(table: string): Promise<ColumnInfo[]> {
  const rows = (await (await db())
    .prepare(
      `SELECT c.column_name AS name, c.data_type AS type,
              CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
              c.column_default AS dflt_value,
              CASE WHEN EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage k
                    ON k.constraint_name = tc.constraint_name AND k.table_name = tc.table_name
                 WHERE tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY'
                   AND k.column_name = c.column_name) THEN 1 ELSE 0 END AS pk
         FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = ?
        ORDER BY c.ordinal_position`
    )
    .all(table)) as unknown as ColumnInfo[];
  // sync_xid is PostgreSQL's own bookkeeping for the offline pull (db/migrations/*_sync-xid.sql),
  // not part of the schema the tests describe.
  return rows.filter((r) => r.name !== "sync_xid").map((r) => ({
    ...r,
    type: SQLITE_TYPE[r.type] ?? r.type.toUpperCase(),
    // 'lead'::text -> 'lead', as SQLite reports a default
    dflt_value: r.dflt_value == null ? null : r.dflt_value.replace(/::[a-z ]+$/, ""),
  }));
}

/** The indexes on `table`, named as created (primary-key and UNIQUE-constraint indexes are left out). */
export async function indexesOn(table: string): Promise<string[]> {
  const rows = await (await db())
    .prepare(
      `SELECT i.indexname AS name FROM pg_indexes i
        WHERE i.schemaname = 'public' AND i.tablename = ?
          AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conname = i.indexname)`
    )
    .all(table);
  return (rows as unknown as { name: string }[]).map((r) => r.name);
}

export async function indexExists(name: string): Promise<boolean> {
  const row = await (await db()).prepare("SELECT 1 AS x FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?").get(name);
  return row !== undefined;
}

/** The CREATE INDEX statement, as PostgreSQL prints it back. */
export async function indexDef(name: string): Promise<string | undefined> {
  const row = await (await db()).prepare("SELECT indexdef AS sql FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?").get(name);
  return (row as { sql: string } | undefined)?.sql;
}

export async function tableExists(name: string): Promise<boolean> {
  return (await tableNames()).includes(name);
}

/** Every table the app made (not PostGIS's or node-pg-migrate's). */
export async function tableNames(): Promise<string[]> {
  const rows = await (await db())
    .prepare(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name NOT IN ('spatial_ref_sys', 'pgmigrations')
        ORDER BY table_name`
    )
    .all();
  return (rows as unknown as { name: string }[]).map((r) => r.name);
}

/** PRAGMA foreign_key_list(table)'s from / table / to, read from the catalog. */
export async function foreignKeys(table: string): Promise<{ from: string; table: string; to: string | null }[]> {
  return (await (await db())
    .prepare(
      `SELECT kcu.column_name AS "from", ccu.table_name AS "table", ccu.column_name AS "to"
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = ?`
    )
    .all(table)) as unknown as { from: string; table: string; to: string | null }[];
}
