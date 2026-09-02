import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-academy-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  objectionCardFor,
  listObjectionCards,
  upsertObjectionCard,
  academyManifest,
  markLessonDone,
  lessonProgress,
} = await import("@/lib/repo/academy");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let uid = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM objection_cards WHERE organization_id IS NOT NULL; DELETE FROM lesson_progress; DELETE FROM users WHERE id>0;");
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
  uid = Number(
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('a','x','م','salesperson',?,1)").run(new Date().toISOString()).lastInsertRowid
  );
});

describe("academy repo", () => {
  it("objectionCardFor returns the starter for a known code", () => {
    const c = objectionCardFor(1, "PRICE_OBJECTION");
    expect(c?.script_fa).toContain("قیمت");
  });

  it("a tenant override wins over the starter", () => {
    upsertObjectionCard(1, { outcome_code: "PRICE_OBJECTION", title_fa: "خودمان", script_fa: "متن اختصاصی" });
    expect(objectionCardFor(1, "PRICE_OBJECTION")?.script_fa).toBe("متن اختصاصی");
    // org 2 still sees the default
    expect(objectionCardFor(2, "PRICE_OBJECTION")?.script_fa).toContain("قیمت");
  });

  it("a customer_type-specific card beats a generic one", () => {
    upsertObjectionCard(1, {
      outcome_code: "PRICE_OBJECTION",
      customer_type: "RESTAURANT",
      title_fa: "رستوران",
      script_fa: "برای رستوران",
    });
    expect(objectionCardFor(1, "PRICE_OBJECTION", "RESTAURANT")?.script_fa).toBe("برای رستوران");
    expect(objectionCardFor(1, "PRICE_OBJECTION", "HOTEL")?.customer_type).toBeNull();
  });

  it("markLessonDone is idempotent and lessonProgress reflects it", () => {
    markLessonDone(1, uid, "02-phone-sales");
    markLessonDone(1, uid, "02-phone-sales");
    const p = lessonProgress(1, uid);
    expect(p).toHaveLength(1);
    expect(p[0].lesson_slug).toBe("02-phone-sales");
  });

  it("academyManifest lists the two stub modules in order", () => {
    const m = academyManifest();
    expect(m.map((x) => x.slug)).toEqual(["01-market-and-customer", "02-phone-sales"]);
    expect(m.every((x) => x.status === "stub")).toBe(true);
  });

  it("listObjectionCards returns one row per (code, type)", () => {
    const all = listObjectionCards(1);
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(new Set(all.map((c) => c.outcome_code)).size).toBeGreaterThanOrEqual(8);
  });
});
