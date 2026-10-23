// A new, empty PostgreSQL database built from db/migrations (Wave P). Used by the test run's
// template and by the demo seed, which both start from nothing every time.
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const NAME = /^[a-z_][a-z0-9_]*$/;

/** `baseUrl` with its database swapped for `name`. */
export function databaseUrl(baseUrl, name) {
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
}

/** The database a connection string points at. */
export function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1)) || "postgres";
}

async function admin(baseUrl, fn) {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function databaseExists(baseUrl, name) {
  return await admin(baseUrl, async (c) => (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount > 0);
}

/** Drops `name` (closing anyone still connected) and every database matching `likePattern`.
 *  @param {string} baseUrl @param {string} name @param {string | null} [likePattern] */
export async function dropDatabases(baseUrl, name, likePattern = null) {
  if (!NAME.test(name)) throw new Error(`not a plain database name: ${name}`);
  await admin(baseUrl, async (c) => {
    const old = await c.query("SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE $2", [name, likePattern ?? name]);
    for (const { datname } of old.rows) await c.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  });
}

/** Drops and recreates `name`, then applies db/migrations to it. Returns its URL. */
export async function freshDatabase(baseUrl, name) {
  await dropDatabases(baseUrl, name);
  await admin(baseUrl, (c) => c.query(`CREATE DATABASE "${name}"`));
  const url = databaseUrl(baseUrl, name);
  execFileSync("npx", ["node-pg-migrate", "up", "-m", "db/migrations"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, DATABASE_URL: url },
  });
  return url;
}
