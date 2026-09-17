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
const uid = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('igrep','x','ای‌جی','salesperson',?,1)").run(now).lastInsertRowid);
const session: Session = { user: { id: uid } as Session["user"], role: "salesperson", groupId: null, organizationId: 1 };
afterAll(() => { db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(process.env.ROUTEFLOW_DB_PATH! + s, { force: true }); });

const PIN = JSON.stringify({ lat: 35.7, lng: 51.4, precision: "approx" });
const answersWith = (instagram: string) => [
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
  it("stores the bare handle and blocks a second business with the same page", () => {
    const a = createLead(session, { answers: answersWith("https://www.instagram.com/Kababi.Nayeb/?hl=fa") as never });
    expect(db.prepare("SELECT instagram FROM customers WHERE id = ?").get(a.id)).toEqual({ instagram: "kababi.nayeb" });
    expect(() => createLead(session, { answers: answersWith("@Kababi.Nayeb") as never }))
      .toThrow(expect.objectContaining({ status: 409 }));
    const other = createLead(session, { answers: answersWith("cafe.lamiz") as never });
    expect(db.prepare("SELECT instagram FROM customers WHERE id = ?").get(other.id)).toEqual({ instagram: "cafe.lamiz" });
  });
  it("rejects a value that is not a page", () => {
    expect(() => createLead(session, { answers: answersWith("کافه لمیز") as never })).toThrow(expect.objectContaining({ status: 400 }));
  });
  it("edits the page on the profile and refuses one another business owns", () => {
    const rows = db.prepare("SELECT id FROM customers ORDER BY id").all() as { id: number }[];
    const [a, b] = rows;
    updateBusinessFields(session, a.id, { instagram: " https://instagram.com/lamiz.nayeb " });
    expect(profileFor(session, a.id)!.business.instagram).toBe("lamiz.nayeb");
    expect(() => updateBusinessFields(session, b.id, { instagram: "lamiz.nayeb" })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => updateBusinessFields(session, b.id, { instagram: "https://snappfood.ir/x" })).toThrow(expect.objectContaining({ status: 400 }));
    updateBusinessFields(session, b.id, { instagram: null });
    expect(profileFor(session, b.id)!.business.instagram).toBeNull();
  });
});
