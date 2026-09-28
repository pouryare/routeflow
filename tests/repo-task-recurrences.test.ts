import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-task-recurrences-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { listRecurrences, createRecurrence, patchRecurrence, removeRecurrence } = await import(
  "@/lib/repo/taskRecurrences"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let user = 0;
beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM task_recurrences; DELETE FROM users WHERE id > 0;");
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
  user = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`rec${Date.now()}`, "x", "م", "group_manager", new Date().toISOString()).lastInsertRowid
  );
});

describe("task_recurrences repo", () => {
  it("creates, lists (active filter), patches, and removes", () => {
    const r = createRecurrence(
      1,
      {
        title: "یافتن مشتری جدید — منطقهٔ ۴ تهران",
        kind: "outreach",
        role_hint: "phone_sales",
        rrule: "weekly:mon",
        priority: "NORMAL",
      },
      user
    );
    expect(r.id).toBeGreaterThan(0);
    expect(r.active).toBe(1);
    expect(r.created_by).toBe(user);

    expect(listRecurrences(1).some((x) => x.id === r.id)).toBe(true);
    expect(listRecurrences(1, { active: true }).some((x) => x.id === r.id)).toBe(true);

    const p = patchRecurrence(1, r.id, { active: 0, title: "غیرفعال" });
    expect(p?.active).toBe(0);
    expect(p?.title).toBe("غیرفعال");
    expect(listRecurrences(1, { active: true }).some((x) => x.id === r.id)).toBe(false);

    expect(removeRecurrence(1, r.id)).toBe(true);
    expect(patchRecurrence(1, r.id, { title: "gone" })).toBe(null);
    expect(removeRecurrence(1, r.id)).toBe(false);
  });

  it("rejects a bad rrule on create and on patch", () => {
    expect(() =>
      createRecurrence(1, { title: "x", kind: "admin", rrule: "weekly:funday", priority: "LOW" }, user)
    ).toThrow();
    expect(() =>
      createRecurrence(1, { title: "x", kind: "admin", rrule: "monthly:31", priority: "LOW" }, user)
    ).toThrow();
    const ok = createRecurrence(1, { title: "x", kind: "admin", rrule: "daily", priority: "LOW" }, user);
    expect(() => patchRecurrence(1, ok.id, { rrule: "yearly" })).toThrow();
  });

  it("is organisation-scoped", () => {
    const u2 = Number(
      getDb()
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,2)"
        )
        .run(`o2${Date.now()}`, "x", "م", "group_manager", new Date().toISOString()).lastInsertRowid
    );
    const mine = createRecurrence(1, { title: "mine", kind: "admin", rrule: "daily", priority: "LOW" }, user);
    createRecurrence(2, { title: "theirs", kind: "admin", rrule: "daily", priority: "LOW" }, u2);
    expect(listRecurrences(1).map((x) => x.title)).toContain("mine");
    expect(listRecurrences(1).map((x) => x.title)).not.toContain("theirs");
    expect(patchRecurrence(2, mine.id, { title: "x" })).toBe(null); // cannot patch across orgs
  });
});
