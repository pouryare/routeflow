// A small connection for the operator scripts (create-user, disable-second-factor) that run from a
// server shell, before or without the app: plain ESM, no build step, the same two engines the app
// has. SQL is written with `?` placeholders; on PostgreSQL they become $1, $2, ...
//
//   const db = await openScriptDb();            // DB_DIALECT=postgres + DATABASE_URL, else ROUTEFLOW_DB_PATH
//   await db.get("SELECT ...", a, b);           // one row or undefined
//   await db.all("SELECT ...");                 // rows
//   await db.run("UPDATE ...", a);              // nothing returned
//   await db.columns("users");                  // column names, [] when the table is missing
//   await db.close();
//
// Scripts run as the database owner, which row-level security does not apply to, so they see and
// change every company's rows, as an operator at a server shell should.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const isPostgres = process.env.DB_DIALECT === "postgres";

export async function openScriptDb() {
  if (isPostgres) {
    if (!process.env.DATABASE_URL) throw new Error("DB_DIALECT=postgres needs DATABASE_URL");
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const q = async (sql, params) => {
      let i = 0;
      return await client.query(sql.replace(/\?/g, () => `$${++i}`), params);
    };
    return {
      where: `${new URL(process.env.DATABASE_URL).pathname.slice(1) || "postgres"} (PostgreSQL)`,
      get: async (sql, ...p) => (await q(sql, p)).rows[0],
      all: async (sql, ...p) => (await q(sql, p)).rows,
      run: async (sql, ...p) => void (await q(sql, p)),
      columns: async (table) => (await q("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", [table])).rows.map((r) => r.column_name),
      close: async () => await client.end(),
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const file = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
  const db = new DatabaseSync(file);
  return {
    where: file,
    get: async (sql, ...p) => db.prepare(sql).get(...p),
    all: async (sql, ...p) => db.prepare(sql).all(...p),
    run: async (sql, ...p) => void db.prepare(sql).run(...p),
    columns: async (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name),
    close: async () => db.close(),
  };
}
