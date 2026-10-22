import { describe, it, expect, afterAll } from "vitest";
import { dbLayerSource } from "./helpers/dbLayerSource";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-wording-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { REWORDED, refreshRetiredWording } = await import("@/lib/repo/retiredWording");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** Seeds are insert-if-missing, so renaming a word in RULE_SEED, OBJECTION_CARD_SEED or
 *  KPI_DEFINITION_SEED changes nothing in a database that was seeded last month — the
 *  old «بچ» / «لیست» would stay on screen for every existing install. These rows are
 *  rewritten in place, but only where they still hold the seeded text verbatim: a row an
 *  organisation has edited is theirs. */
describe("retired wording in stored rows", () => {
  it("every rewording names a real table and column", () => {
    const db = getDb();
    for (const r of REWORDED) {
      const cols = (db.prepare(`PRAGMA table_info(${r.table})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols, `${r.table}.${r.column}`).toContain(r.column);
    }
  });

  it("rewrites seeded rows that still carry the old text", () => {
    const db = getDb();
    const reverted = new Set<string>();
    for (const r of REWORDED) {
      const n = db.prepare(`UPDATE ${r.table} SET ${r.column} = ? WHERE ${r.column} = ?`).run(r.from, r.to).changes;
      if (Number(n) > 0) reverted.add(r.table);
    }
    // Not vacuous: the three seeded tables really did hold the (new) text to put back.
    expect([...reverted].sort()).toEqual(expect.arrayContaining(["kpi_definitions", "objection_cards", "rules"]));

    refreshRetiredWording(db);

    for (const r of REWORDED) {
      const left = db.prepare(`SELECT COUNT(*) AS n FROM ${r.table} WHERE ${r.column} = ?`).get(r.from) as { n: number };
      expect(left.n, `${r.table}.${r.column} still says «${r.from.slice(0, 30)}»`).toBe(0);
    }
  });

  it("rewrites alerts and recall reminders already raised", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const alert = Number(
      db
        .prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'warning','stock',?,?)")
        .run("بچ رو به انقضا با موجودی", now).lastInsertRowid
    );
    const reminder = Number(
      db
        .prepare("INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer', 1, ?, ?, 0, ?)")
        .run(now.slice(0, 10), "بچ B-7 فراخوان شد — پیگیری کنید", now).lastInsertRowid
    );

    refreshRetiredWording(db);

    expect((db.prepare("SELECT title FROM alerts WHERE id = ?").get(alert) as { title: string }).title).toBe(
      "سری ساخت رو به انقضا با موجودی"
    );
    expect((db.prepare("SELECT message FROM reminders WHERE id = ?").get(reminder) as { message: string }).message).toBe(
      "سری ساخت B-7 فراخوان شد — پیگیری کنید"
    );
  });

  it("leaves a row an organisation wrote itself alone, and is safe to run twice", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const own = Number(
      db
        .prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'opportunity','stock',?,?)")
        .run("بچ‌های شمال را ببین", now).lastInsertRowid
    );
    refreshRetiredWording(db);
    refreshRetiredWording(db);
    expect((db.prepare("SELECT title FROM alerts WHERE id = ?").get(own) as { title: string }).title).toBe("بچ‌های شمال را ببین");
  });

  it("runs on every open, right after the seeds", () => {
    const src = dbLayerSource(); // getDb() and the migration eras it runs
    expect(src).toMatch(/seedKpiDefinitions\(db\);[\s\S]{0,200}refreshRetiredWording\(db\);/);
  });
});
