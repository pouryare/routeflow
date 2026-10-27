// A small connection for the operator scripts (create-user, disable-second-factor) that run from a
// server shell, before or without the app: plain ESM, no build step. SQL is written with `?`
// placeholders, which become $1, $2, ...
//
//   const db = await openScriptDb();            // DATABASE_URL
//   await db.get("SELECT ...", a, b);           // one row or undefined
//   await db.all("SELECT ...");                 // rows
//   await db.run("UPDATE ...", a);              // nothing returned
//   await db.columns("users");                  // column names, [] when the table is missing
//   await db.close();
//
// Scripts run as the database owner, which row-level security does not apply to, so they see and
// change every company's rows, as an operator at a server shell should.

export async function openScriptDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (source /etc/routeflow/env)");
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
