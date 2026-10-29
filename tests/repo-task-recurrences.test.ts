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
beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM task_recurrences; DELETE FROM users WHERE id > 0;");
  await db.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?) ON CONFLICT DO NOTHING").run(
    new Date().toISOString()
  );
  user = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`rec${Date.now()}`, "x", "م", "group_manager", new Date().toISOString())).lastInsertRowid
  );
});

describe("task_recurrences repo", () => {
  it("creates, lists (active filter), patches, and removes", async () => {
    const r = await createRecurrence(
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

    expect((await listRecurrences(1)).some((x) => x.id === r.id)).toBe(true);
    expect((await listRecurrences(1, { active: true })).some((x) => x.id === r.id)).toBe(true);

    const p = await patchRecurrence(1, r.id, { active: 0, title: "غیرفعال" });
    expect(p?.active).toBe(0);
    expect(p?.title).toBe("غیرفعال");
    expect((await listRecurrences(1, { active: true })).some((x) => x.id === r.id)).toBe(false);

    expect(await removeRecurrence(1, r.id)).toBe(true);
    expect(await patchRecurrence(1, r.id, { title: "gone" })).toBe(null);
    expect(await removeRecurrence(1, r.id)).toBe(false);
  });

  it("rejects a bad rrule on create and on patch", async () => {
    await expect((async () =>
      await createRecurrence(1, { title: "x", kind: "admin", rrule: "weekly:funday", priority: "LOW" }, user))()).rejects.toThrow();
    await expect((async () =>
      await createRecurrence(1, { title: "x", kind: "admin", rrule: "monthly:31", priority: "LOW" }, user))()).rejects.toThrow();
    const ok = await createRecurrence(1, { title: "x", kind: "admin", rrule: "daily", priority: "LOW" }, user);
    await expect((async () => await patchRecurrence(1, ok.id, { rrule: "yearly" }))()).rejects.toThrow();
  });

  it("is organisation-scoped", async () => {
    const u2 = Number(
      (await getDb()
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,2)"
        )
        .run(`o2${Date.now()}`, "x", "م", "group_manager", new Date().toISOString())).lastInsertRowid
    );
    const mine = await createRecurrence(1, { title: "mine", kind: "admin", rrule: "daily", priority: "LOW" }, user);
    await createRecurrence(2, { title: "theirs", kind: "admin", rrule: "daily", priority: "LOW" }, u2);
    expect((await listRecurrences(1)).map((x) => x.title)).toContain("mine");
    expect((await listRecurrences(1)).map((x) => x.title)).not.toContain("theirs");
    expect(await patchRecurrence(2, mine.id, { title: "x" })).toBe(null); // cannot patch across orgs
  });

  it("ignores or refuses body keys that are not plain fields (no SQL from keys, no moving org)", async () => {
    const r = await createRecurrence(1, { title: "keep", kind: "admin", rrule: "daily", priority: "LOW" }, user);
    // A key shaped like SQL is not a field: it is dropped, never executed.
    await patchRecurrence(1, r.id, { "title = 'pwned', kind": "admin", title: "ok" } as never);
    const after = await patchRecurrence(1, r.id, { organization_id: 2 } as never);
    expect(after?.title).toBe("ok");
    expect(after?.organization_id).toBe(1);
    await expect(patchRecurrence(1, r.id, { priority: "x" } as never)).rejects.toThrow();
    await expect(patchRecurrence(1, r.id, { group_id: "1; DROP TABLE users" } as never)).rejects.toThrow();
  });
});
