import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { databaseExists, dropDatabases } from "../scripts/pg/fresh-database.mjs";

/** The demo seed's guard on PostgreSQL, where "the real database" is DATABASE_URL's own
 *  database rather than data/routeflow.db (tests/seed-demo-refusal.test.ts covers the file
 *  path guard on SQLite). Every case here is refused before anything is written. */

const PG = process.env.DB_DIALECT === "postgres";
const REPO = path.resolve(__dirname, "..");
const BASE_URL = process.env.DATABASE_URL ?? "";
const real = PG ? decodeURIComponent(new URL(BASE_URL).pathname.slice(1)) || "postgres" : "";
const existing = `rf_demo_refuse_${process.pid}`;

function runSeed(args: string[]): { out: string; code: number | null } {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings",
     "--import", path.join(REPO, "scripts/_ts-register.mjs"),
     path.join(REPO, "scripts/seed-demo.ts"), ...args],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, SESSION_SECRET: "x", ROUTEFLOW_PG_TEMPLATE: "" } },
  );
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
}

afterAll(async () => {
  if (PG) await dropDatabases(BASE_URL, existing);
});

describe.skipIf(!PG)("the demo seed refuses the real PostgreSQL database", () => {
  it("refuses DATABASE_URL's own database, even with --force", () => {
    const r = runSeed([`--db=${real}`, "--force"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("refusing to seed the real database");
  });

  it("refuses a name that is not a plain database name", () => {
    const r = runSeed(['--db=demo"; DROP DATABASE postgres; --']);
    expect(r.code).toBe(2);
    expect(r.out).toContain("plain database name");
  });

  it("refuses to overwrite an existing database without --force", async () => {
    const pg = (await import("pg")).default;
    const admin = new pg.Client({ connectionString: BASE_URL });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${existing}`);
    } finally {
      await admin.end();
    }
    const r = runSeed([`--db=${existing}`]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("already exists");
    expect(await databaseExists(BASE_URL, existing)).toBe(true);
  });
});
