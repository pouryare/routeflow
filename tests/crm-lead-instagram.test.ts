import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-lead-ig-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createLead } = await import("@/lib/repo/crm/write");
const { updateBusinessFields } = await import("@/lib/repo/crm/fields");
const { profileFor } = await import("@/lib/repo/crm/profile");
type Session = import("@/lib/session").Session;

const db = getDb();
const now = new Date().toISOString();
const uid = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('igrep','x','ای‌جی','phone_sales',?,1)").run(now)).lastInsertRowid);
const session: Session = { user: { id: uid } as Session["user"], role: "phone_sales", groupId: null, organizationId: 1, roles: ["phone_sales"], hasRole: (x) => x === "phone_sales" };
afterAll(async () => { await db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });

const PIN = JSON.stringify({ lat: 35.7, lng: 51.4, precision: "approx" });
const answersWith = (instagram: unknown) => [
  { step: "src", option: "FIELD_VISIT" },
  { step: "here", option: "nothere" },
  { step: "basics", option: "ok", value: JSON.stringify({ name: "کافه اینستا", phone: "", instagram, branch_of: null }) },
  { step: "loc", option: "map" },
  { step: "pin", option: "ok", value: PIN },
  { step: "type", option: "CAFE" },
  { step: "price", option: "mid" },
  { step: "hours", option: "skip" },
  { step: "first", option: "driver" },
];

describe("Instagram on the lead-save path", () => {
  it("stores the bare handle and blocks a second business with the same page", async () => {
    const a = await createLead(session, { answers: answersWith("https://www.instagram.com/Kababi.Nayeb/?hl=fa") as never });
    expect(await db.prepare("SELECT instagram FROM customers WHERE id = ?").get(a.id)).toEqual({ instagram: "kababi.nayeb" });
    await expect((async () => await createLead(session, { answers: answersWith("@Kababi.Nayeb") as never }))()).rejects.toThrow(expect.objectContaining({ status: 409 }));
    const other = await createLead(session, { answers: answersWith("cafe.lamiz") as never });
    expect(await db.prepare("SELECT instagram FROM customers WHERE id = ?").get(other.id)).toEqual({ instagram: "cafe.lamiz" });
  });
  it.each([42, {}, [], true].map(value => [value]))("rejects malformed Instagram input %j with 400", async instagram => {
    await expect((async () => await createLead(session, { answers: answersWith(instagram) }))()).rejects.toThrow(expect.objectContaining({ status: 400 }));
  });
  it("rejects a value that is not a page", async () => {
    await expect((async () => await createLead(session, { answers: answersWith("کافه لمیز") as never }))()).rejects.toThrow(expect.objectContaining({ status: 400 }));
  });
  it("edits the page on the profile and refuses one another business owns", async () => {
    const a = await createLead(session, { answers: answersWith("edit.first") });
    const b = await createLead(session, { answers: answersWith("edit.second") });
    await updateBusinessFields(session, a.id, { instagram: " https://instagram.com/lamiz.nayeb " });
    expect((await profileFor(session, a.id))!.business.instagram).toBe("lamiz.nayeb");
    await expect((async () => await updateBusinessFields(session, b.id, { instagram: "lamiz.nayeb" }))()).rejects.toThrow(expect.objectContaining({ status: 409 }));
    await expect((async () => await updateBusinessFields(session, b.id, { instagram: "https://snappfood.ir/x" }))()).rejects.toThrow(expect.objectContaining({ status: 400 }));
    await updateBusinessFields(session, b.id, { instagram: null });
    expect((await profileFor(session, b.id))!.business.instagram).toBeNull();
  });
});
