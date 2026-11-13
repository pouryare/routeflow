import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";

const testDbPath = path.join(os.tmpdir(), `rf-pgboss-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { testDatabaseUrl } = await import("@/lib/database/pg");
const { PgBoss } = await import("pg-boss");
const { workerOptions, QUEUES, startWorker, stopWorker, workerRunning } = await import("@/lib/worker");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** The connection string of this file's own copy of the template database. */
async function ownUrl(): Promise<string> {
  await getDb().prepare("SELECT 1").get(); // makes the copy
  return testDatabaseUrl(process.env.DATABASE_URL!, process.env.ROUTEFLOW_PG_TEMPLATE!, testDbPath).url;
}

describe("background worker (E3)", () => {
  it("starts on the schema the migration made, without touching it", async () => {
    const url = await ownUrl();
    const before = new pg.Client({ connectionString: url });
    await before.connect();
    const v1 = (await before.query("SELECT version FROM pgboss.version")).rows;
    const boss = new PgBoss(workerOptions(url));
    boss.on("error", () => {});
    try {
      await boss.start(); // fails if the installed library wants another schema version than the migration made
      const v2 = (await before.query("SELECT version FROM pgboss.version")).rows;
      expect(v2).toEqual(v1);
    } finally {
      await boss.stop({ graceful: false });
      await before.end();
    }
  });

  it("runs a job to completion, and a failing job is tried again", async () => {
    const boss = new PgBoss(workerOptions(await ownUrl()));
    boss.on("error", () => {});
    await boss.start();
    try {
      await boss.createQueue("t.ok");
      await boss.createQueue("t.flaky", { retryLimit: 2, retryDelay: 1 });
      const done: string[] = [];
      let tries = 0;
      await boss.work("t.ok", { pollingIntervalSeconds: 0.5 }, async () => void done.push("ok"));
      await boss.work("t.flaky", { pollingIntervalSeconds: 0.5 }, async () => {
        tries += 1;
        if (tries < 2) throw new Error("first try fails");
        done.push("flaky");
      });
      await boss.send("t.ok", {});
      await boss.send("t.flaky", {});
      const until = Date.now() + 15_000;
      while (done.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
      expect(done.sort()).toEqual(["flaky", "ok"]);
      expect(tries).toBe(2);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 30_000);

  it("startWorker schedules its queues, and an event job re-runs a pending reaction", async () => {
    const boss = await startWorker(await ownUrl());
    expect(boss).not.toBeNull();
    expect(workerRunning()).toBe(true);
    try {
      const names = (await boss!.getSchedules()).map((x) => x.name).sort();
      expect(names).toEqual([QUEUES.eventsDrain, QUEUES.rulesSweep, QUEUES.logsPurge, QUEUES.leadsRevive].sort());
      const now = new Date().toISOString();
      const db = getDb();
      await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('wo','x','م','owner',1,?,1)").run(now);
      await db.prepare("INSERT INTO events (organization_id, kind, entity_type, entity_id, occurred_at, created_at, pending) VALUES (1,'delivery.failed','order',9,?,?,TRUE)").run(now, now);
      await boss!.send(QUEUES.eventsDrain, {});
      const until = Date.now() + 20_000;
      let pending = 1;
      while (pending > 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 300));
        pending = Number(((await db.prepare("SELECT COUNT(*) n FROM events WHERE pending").get()) as { n: number }).n);
      }
      expect(pending).toBe(0);
    } finally {
      await stopWorker();
    }
    expect(workerRunning()).toBe(false);
  }, 40_000);

  it("the web role can use the queue without owning it", async () => {
    const c = new pg.Client({ connectionString: await ownUrl() });
    await c.connect();
    try {
      await c.query("SET ROLE routeflow_app");
      await c.query("SELECT count(*) FROM pgboss.job");
      await expect(c.query("CREATE TABLE pgboss.nope (a int)")).rejects.toThrow();
    } finally {
      await c.end();
    }
  });
});
