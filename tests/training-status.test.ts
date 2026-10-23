import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-training-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { trainingStatus, markLessonDone, academyManifest } = await import("@/lib/repo/academy");
const TrainingTable = (await import("@/components/sales/TrainingTable")).default;

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("trainingStatus (F133)", () => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  const groupA = Number(g.run("A", "a", now).lastInsertRowid);
  const groupB = Number(g.run("B", "b", now).lastInsertRowid);
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)");
  const phone = Number(u.run("p", "x", "پریسا", "phone_sales", groupA, now).lastInsertRowid);
  const field = Number(u.run("f", "x", "فرهاد", "field_rep", groupB, now).lastInsertRowid);
  u.run("d", "x", "داوود", "delivery_driver", groupA, now); // no lesson is required of a driver
  markLessonDone(1, phone, "01-market-and-customer");

  it("the manifest names who each lesson is required for", () => {
    expect(academyManifest().map((m) => m.required_for)).toEqual([["phone_sales", "field_rep"], ["phone_sales"]]);
  });

  it("the owner sees everyone with a required lesson: done, still to do, or not required", () => {
    const t = trainingStatus(sess(99, "owner", null))!;
    expect(new Set(t.people.map((p) => p.name))).toEqual(new Set(["پریسا", "فرهاد"]));
    expect(t.people.find((p) => p.id === phone)!.lessons).toEqual({ "01-market-and-customer": "done", "02-phone-sales": "todo" });
    expect(t.people.find((p) => p.id === field)!.lessons).toEqual({ "01-market-and-customer": "todo", "02-phone-sales": "na" });
    const html = renderToStaticMarkup(h(TrainingTable, t));
    expect(html).toContain("انجام شد");
    expect(html).toContain("مانده");
  });

  it("a group manager sees their group only; a salesperson gets no table", () => {
    expect(trainingStatus(sess(98, "group_manager", groupB))!.people.map((p) => p.name)).toEqual(["فرهاد"]);
    expect(trainingStatus(sess(phone, "phone_sales", groupA))).toBeNull();
  });
});
