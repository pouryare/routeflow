import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-academy-lessons-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const L = await import("@/lib/repo/academyLessons");
const { academyOverview, markLessonDone, trainingStatus } = await import("@/lib/repo/academy");
const { parseLesson } = await import("@/components/academy/LessonBody");
import type { Session } from "@/lib/session";
import type { Role } from "@/lib/roles";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = "2026-01-01T00:00:00.000Z";

async function user(name: string, role: Role, groupId: number | null = null, teach = false): Promise<Session> {
  const r = await getDb()
    .prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id,group_id,can_teach) VALUES (?,?,?,?,?,1,?,?)")
    .run(name, "x", name, role, NOW, groupId, teach);
  const id = Number(r.lastInsertRowid);
  return {
    user: { id, role, created_at: NOW, can_teach: teach } as never, role, roles: [role], groupId, organizationId: 1,
    hasRole: (x: Role) => x === role,
  };
}

beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM lesson_progress; DELETE FROM academy_lessons; DELETE FROM academy_categories; DELETE FROM users WHERE id>0;");
});

describe("company lessons", () => {
  it("only the owner, a group manager and a trainer may write; others are refused", async () => {
    const driver = await user("d", "delivery_driver");
    await expect(L.saveLesson(driver, { title: "x" })).rejects.toThrow(L.LessonError);
    const trainer = await user("t", "delivery_driver", null, true);
    expect(await L.saveLesson(trainer, { title: "از راننده" })).toBeGreaterThan(0);
  });

  it("a trainer edits only their own lessons; the owner edits every one", async () => {
    const owner = await user("o", "owner");
    const trainer = await user("t", "delivery_driver", null, true);
    const ownLesson = await L.saveLesson(trainer, { title: "من" });
    const ownersLesson = await L.saveLesson(owner, { title: "مالک" });
    await expect(L.saveLesson(trainer, { id: ownersLesson, title: "دست‌کاری" })).rejects.toThrow(/نمی‌توانید/);
    expect(await L.saveLesson(owner, { id: ownLesson, title: "ویرایش مالک" })).toBe(ownLesson);
  });

  it("a draft is hidden from readers; publishing shows it only to the chosen roles", async () => {
    const owner = await user("o", "owner");
    const driver = await user("d", "delivery_driver");
    const rep = await user("r", "field_rep");
    const id = await L.saveLesson(owner, { title: "تحویل", roles: ["delivery_driver"] });
    expect((await L.listCompanyLessons(driver)).map((l) => l.id)).toEqual([]);
    await L.saveLesson(owner, { id, title: "تحویل", roles: ["delivery_driver"], publish: true });
    expect((await L.listCompanyLessons(driver)).map((l) => l.id)).toEqual([id]);
    expect(await L.listCompanyLessons(rep)).toEqual([]);
  });

  it("required needs a role; a bad deadline is refused", async () => {
    const owner = await user("o", "owner");
    await expect(L.saveLesson(owner, { title: "a", required: true })).rejects.toThrow(/نقش/);
    await expect(L.saveLesson(owner, { title: "a", required: true, roles: ["field_rep"], due_days: 0 })).rejects.toThrow(/۳۶۵/);
  });

  it("an edit asking for a re-read makes earlier completions stop counting", async () => {
    const owner = await user("o", "owner");
    const driver = await user("d", "delivery_driver");
    const id = await L.saveLesson(owner, { title: "پالت", roles: ["delivery_driver"], required: true, publish: true });
    await markLessonDone(1, driver.user.id, L.companySlug(id));
    expect((await academyOverview(driver)).find((i) => i.slug === L.companySlug(id))?.done).toBe(true);

    // A small fix: still done, but marked as updated.
    await L.saveLesson(owner, { id, title: "پالت", roles: ["delivery_driver"], required: true, publish: true });
    let item = (await academyOverview(driver)).find((i) => i.slug === L.companySlug(id));
    expect(item?.done).toBe(true);
    expect(item?.updated).toBe(true);

    // An important change: everybody reads again.
    await L.saveLesson(owner, { id, title: "پالت", roles: ["delivery_driver"], required: true, publish: true, reread: true });
    item = (await academyOverview(driver)).find((i) => i.slug === L.companySlug(id));
    expect(item?.done).toBe(false);
    expect(item?.required).toBe(true);
  });

  it("a required company lesson shows in the manager's training table", async () => {
    const owner = await user("o", "owner");
    await user("d", "delivery_driver");
    const id = await L.saveLesson(owner, { title: "قانون", roles: ["delivery_driver"], required: true, publish: true });
    const t = await trainingStatus(owner);
    expect(t?.lessons.map((l) => l.slug)).toContain(L.companySlug(id));
    // OI1: each person also shows how many of their role's in-app tutorials they have finished
    const driver = t?.people.find((p) => p.name === "d");
    expect(driver?.tutorials.total).toBeGreaterThan(0);
    expect(driver?.tutorials.done).toBe(0);
  });

  it("a category with lessons cannot be deleted, and only the owner renames", async () => {
    const owner = await user("o", "owner");
    const trainer = await user("t", "delivery_driver", null, true);
    const cat = await L.createCategory(owner, "قوانین تحویل");
    await L.saveLesson(owner, { title: "x", category_id: cat });
    await expect(L.deleteCategory(owner, cat)).rejects.toThrow(/درس/);
    await expect(L.renameCategory(trainer, cat, "y")).rejects.toThrow(L.LessonError);
  });

  it("deleting a lesson drops its progress", async () => {
    const owner = await user("o", "owner");
    const id = await L.saveLesson(owner, { title: "x", publish: true });
    await markLessonDone(1, owner.user.id, L.companySlug(id));
    await L.deleteLesson(owner, id);
    expect(Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM lesson_progress").get()) as { n: number }).n)).toBe(0);
  });

  it("only the owner gives the trainer permission", async () => {
    const owner = await user("o", "owner");
    const driver = await user("d", "delivery_driver");
    await expect(L.setTrainer(driver, driver.user.id, true)).rejects.toThrow(L.LessonError);
    await L.setTrainer(owner, driver.user.id, true);
    const people = await L.listPeopleForTrainers(owner);
    expect(people.find((p) => p.id === driver.user.id)?.can_teach).toBe(true);
  });
});

describe("lesson text", () => {
  it("reads headings, bullets, pictures and paragraphs, and skips the title line", () => {
    expect(parseLesson("[[tutorial:order-new]]")).toEqual([{ kind: "tut", id: "order-new" }]);
    const blocks = parseLesson("# عنوان\n\n## بخش\nیک خط\nخط دو\n\n- الف\n- ب\n\n[[img:7]]\n");
    expect(blocks).toEqual([
      { kind: "h", text: "بخش" },
      { kind: "p", text: "یک خط خط دو" },
      { kind: "li", items: ["الف", "ب"] },
      { kind: "img", id: 7 },
    ]);
  });
});
