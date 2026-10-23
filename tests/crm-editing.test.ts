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
const uid = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('edit','x','edit','owner',?,1)").run(now)).lastInsertRowid);
const session: Session = { user: { id: uid } as Session["user"], role: "owner", groupId: null, organizationId: 1, roles: ["owner"], hasRole: (x) => x === "owner" };
let n = 0;
const customer = async () => Number((await db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES (?,'کافه',?,1)").run(`edit-${++n}`, now)).lastInsertRowid);
afterAll(async () => { await db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });
it("edits business display fields without changing lifecycle, and logs corrections", async () => {
  const id = await customer();
  await updateBusinessFields(session, id, { business_name: "  کافه بهار  ", phone: "۰۹۱۲۱۲۳۴۵۶۷", business_type: "CAFE" });
  expect((await profileFor(session, id))!.business).toMatchObject({ business_name: "کافه بهار", phone_norm: "9121234567" });
  expect(await db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'correction'").get(id)).toEqual({ n: 1 });
  for (const input of [{}, null, { owner_user_id: uid }, { phone: "bad" }, { business_name: 3 }, { working_hours: [{}] }]) {
    await expect((async () => await updateBusinessFields(session, id, input))()).rejects.toThrow(expect.objectContaining({ status: 400 }));
  }
  await expect((async () => await updateBusinessFields({ ...session, organizationId: 99 }, id, { address: "a" }))()).rejects.toThrow(expect.objectContaining({ status: 404 }));
});
it("rejects duplicate phone updates and permits the current phone", async () => {
  const a = await customer(), b = await customer();
  await updateBusinessFields(session, a, { phone: "09121112233" });
  await updateBusinessFields(session, a, { phone: "09121112233" });
  await expect((async () => await updateBusinessFields(session, b, { phone: "09121112233" }))()).rejects.toThrow(expect.objectContaining({ status: 409 }));
});
it("verifies information without converting the lead or counting a call", async () => {
  const id = await customer();
  await verifyBusiness(session, id);
  expect(await db.prepare("SELECT verification,lifecycle,attempt_count FROM customers WHERE id = ?").get(id)).toMatchObject({ verification: "verified", lifecycle: "lead", attempt_count: 0 });
});
it("creates, edits and archives contacts while retaining linked history", async () => {
  const id = await customer(), other = await customer();
  const a = await addContact(session, id, { name: "علی رضایی", role: "PURCHASING", phone: "09123334455" });
  const b = await addContact(session, id, { name: "دوم", is_primary: true });
  expect((await profileFor(session, id))!.contacts[0]).toMatchObject({ id: b.id, is_primary: 1 });
  await expect((async () => await updateContact(session, a.id, { name: "bad" }, other))()).rejects.toThrow(expect.objectContaining({ status: 404 }));
  await expect((async () => await addContact(session, id, { phone: 3 } as never))()).rejects.toThrow(expect.objectContaining({ status: 400 }));
  await db.prepare("INSERT INTO activities (organization_id,customer_id,contact_id,type,occurred_at,created_at) VALUES (1,?,?,'note',?,?)").run(id, b.id, now, now);
  await updateContact(session, b.id, { active: false }, id);
  expect((await profileFor(session, id))!.contacts).toEqual([expect.objectContaining({ id: a.id, name: "علی رضایی", is_primary: 1 })]);
});
it("keeps inactive contacts out of the primary slot and honors explicit demotion", async () => {
  const id = await customer();
  const a = await addContact(session, id, { name: "اول" });
  const b = await addContact(session, id, { name: "دوم", is_primary: true });
  await updateContact(session, b.id, { is_primary: false }, id);
  expect((await profileFor(session, id))!.contacts[0]).toMatchObject({ id: a.id, is_primary: 1 });
  await updateContact(session, b.id, { active: false }, id);
  await updateContact(session, b.id, { active: true }, id);
  expect((await profileFor(session, id))!.contacts.map(c => c.id)).toContain(b.id);
  expect((await profileFor(session, id))!.contacts.find(c => c.id === b.id)!.is_primary).toBe(0);
  await expect((async () => await addContact(session, id, { name: "بسته", active: false }))()).rejects.toThrow(expect.objectContaining({ status: 400 }));
});

