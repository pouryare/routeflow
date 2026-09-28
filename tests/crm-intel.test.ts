import { afterAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "@/lib/session";
process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-intel-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { applyIntel, updateTags } = await import("@/lib/repo/crm/intel");
const { profileFor } = await import("@/lib/repo/crm/profile");
const db = getDb(), now = new Date().toISOString();
const uid = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('intel','x','intel','owner',?,1)").run(now).lastInsertRowid);
const session: Session = { user: { id: uid } as Session["user"], role: "owner", groupId: null, organizationId: 1, roles: ["owner"], hasRole: (x) => x === "owner" };
let n = 0;
const customer = () => Number(db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES (?,'کافه',?,1)").run(`intel-${++n}`, now).lastInsertRowid);
const answers = (unknown = false) => [
  { step: "size", option: unknown ? "unknown" : "medium" },
  { step: "supply", option: unknown ? "unknown" : "distributor" },
  { step: "uses", option: "ok" },
  { step: "when", option: unknown ? "unknown" : "afternoon" },
  { step: "note", option: "ok", value: unknown ? "" : "سراغ مدیر را بگیرید" },
];
afterAll(() => { db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });
it("persists intel without sales effects, retains unknowns, and replays retries only once", () => {
  const id = customer();
  const sales = () => db.prepare("SELECT lifecycle,sales_stage,temperature,attempt_count,next_task_id FROM customers WHERE id=?").get(id);
  const before = sales();
  const input = { answers: answers(), clientUuid: "intel-once" };
  const saved = applyIntel(session, id, input);
  expect(applyIntel(session, id, input)).toEqual(saved);
  applyIntel(session, id, { answers: answers(true) });
  expect(profileFor(session, id)!.business).toMatchObject({ size_band: "medium", supply_channel: "distributor", visit_window: "afternoon", visit_note: "سراغ مدیر را بگیرید" });
  expect(sales()).toEqual(before);
  expect(db.prepare("SELECT count(*) n FROM activities WHERE customer_id=?").get(id)).toEqual({ n: 2 });
});
it("rejects inaccessible targets, invalid answers and reused IDs across businesses", () => {
  const id = customer(), other = customer();
  expect(() => applyIntel({ ...session, organizationId: 999 }, id, { answers: answers() })).toThrow(expect.objectContaining({ status: 404 }));
  for (const bad of [null, {}, { answers: [] }, { answers: [null] }, { answers: [{ step: "size", option: "huge" }] }, { answers: answers(), clientUuid: 4 }]) {
    expect(() => applyIntel(session, id, bad)).toThrow(expect.objectContaining({ status: 400 }));
  }
  applyIntel(session, id, { answers: answers(), clientUuid: "cross-business" });
  expect(() => applyIntel(session, other, { answers: answers(), clientUuid: "cross-business" })).toThrow(expect.objectContaining({ status: 409 }));
  const badProducts = answers(); badProducts[2] = { step: "uses", option: "ok", value: "999999" };
  expect(() => applyIntel(session, id, { answers: badProducts })).toThrow(expect.objectContaining({ status: 400 }));
});
it("replaces and reads normalized tags with validation and tenant scoping", () => {
  const id = customer();
  updateTags(session, id, [" ویژه ", "ویژه", "بازدید"]);
  expect(profileFor(session, id)!.tags).toEqual(["بازدید", "ویژه"]);
  expect(() => updateTags(session, id, [4])).toThrow(expect.objectContaining({ status: 400 }));
  expect(() => updateTags({ ...session, organizationId: 999 }, id, [])).toThrow(expect.objectContaining({ status: 404 }));
  updateTags(session, id, []);
  expect(profileFor(session, id)!.tags).toEqual([]);
});
