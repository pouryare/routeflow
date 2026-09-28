import { afterAll, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-edit-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { updateBusinessFields, verifyBusiness } = await import("@/lib/repo/crm/fields");
const { addContact, updateContact } = await import("@/lib/repo/crm/contacts");
const { profileFor } = await import("@/lib/repo/crm/profile");
type Session = import("@/lib/session").Session;
const db = getDb(), now = new Date().toISOString();
const uid = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('edit','x','edit','owner',?,1)").run(now).lastInsertRowid);
const session: Session = { user: { id: uid } as Session["user"], role: "owner", groupId: null, organizationId: 1, roles: ["owner"], hasRole: (x) => x === "owner" };
let n = 0;
const customer = () => Number(db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES (?,'کافه',?,1)").run(`edit-${++n}`, now).lastInsertRowid);
afterAll(() => { db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });
it("edits business display fields without changing lifecycle, and logs corrections", () => {
  const id = customer();
  updateBusinessFields(session, id, { business_name: "  کافه بهار  ", phone: "۰۹۱۲۱۲۳۴۵۶۷", business_type: "CAFE" });
  expect(profileFor(session, id)!.business).toMatchObject({ business_name: "کافه بهار", phone_norm: "9121234567" });
  expect(db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'correction'").get(id)).toEqual({ n: 1 });
  for (const input of [{}, null, { owner_user_id: uid }, { phone: "bad" }, { business_name: 3 }, { working_hours: [{}] }]) {
    expect(() => updateBusinessFields(session, id, input)).toThrow(expect.objectContaining({ status: 400 }));
  }
  expect(() => updateBusinessFields({ ...session, organizationId: 99 }, id, { address: "a" })).toThrow(expect.objectContaining({ status: 404 }));
});
it("rejects duplicate phone updates and permits the current phone", () => {
  const a = customer(), b = customer();
  updateBusinessFields(session, a, { phone: "09121112233" });
  updateBusinessFields(session, a, { phone: "09121112233" });
  expect(() => updateBusinessFields(session, b, { phone: "09121112233" })).toThrow(expect.objectContaining({ status: 409 }));
});
it("verifies information without converting the lead or counting a call", () => {
  const id = customer();
  verifyBusiness(session, id);
  expect(db.prepare("SELECT verification,lifecycle,attempt_count FROM customers WHERE id = ?").get(id)).toMatchObject({ verification: "verified", lifecycle: "lead", attempt_count: 0 });
});
it("creates, edits and archives contacts while retaining linked history", () => {
  const id = customer(), other = customer();
  const a = addContact(session, id, { name: "علی رضایی", role: "PURCHASING", phone: "09123334455" });
  const b = addContact(session, id, { name: "دوم", is_primary: true });
  expect(profileFor(session, id)!.contacts[0]).toMatchObject({ id: b.id, is_primary: 1 });
  expect(() => updateContact(session, a.id, { name: "bad" }, other)).toThrow(expect.objectContaining({ status: 404 }));
  expect(() => addContact(session, id, { phone: 3 } as never)).toThrow(expect.objectContaining({ status: 400 }));
  db.prepare("INSERT INTO activities (organization_id,customer_id,contact_id,type,occurred_at,created_at) VALUES (1,?,?,'note',?,?)").run(id, b.id, now, now);
  updateContact(session, b.id, { active: false }, id);
  expect(profileFor(session, id)!.contacts).toEqual([expect.objectContaining({ id: a.id, name: "علی رضایی", is_primary: 1 })]);
});
it("keeps inactive contacts out of the primary slot and honors explicit demotion", () => {
  const id = customer();
  const a = addContact(session, id, { name: "اول" });
  const b = addContact(session, id, { name: "دوم", is_primary: true });
  updateContact(session, b.id, { is_primary: false }, id);
  expect(profileFor(session, id)!.contacts[0]).toMatchObject({ id: a.id, is_primary: 1 });
  updateContact(session, b.id, { active: false }, id);
  updateContact(session, b.id, { active: true }, id);
  expect(profileFor(session, id)!.contacts.map(c => c.id)).toContain(b.id);
  expect(profileFor(session, id)!.contacts.find(c => c.id === b.id)!.is_primary).toBe(0);
  expect(() => addContact(session, id, { name: "بسته", active: false })).toThrow(expect.objectContaining({ status: 400 }));
});

