import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { type Session } from "@/lib/session";
import { normPhone } from "@/lib/crm/phone";
import { CONTACT_ROLES, isDecider, isOneOf, type ContactRole } from "@/lib/crm/vocab";
import { findDuplicates } from "./dedupe";
import { CrmError, writableBusiness } from "./write";

export interface ContactInput {
  name?: string | null; role?: string; phone?: string | null; whatsapp?: string | null;
  best_time?: string | null; note?: string | null; is_primary?: boolean; active?: boolean;
}

const text = (v: string | null | undefined, max: number): string | null => (v ?? "").trim().slice(0, max) || null;

function validateInput(input: ContactInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length) throw new CrmError(400, "اطلاعات مخاطب نامعتبر است");
  const allowed = ["name", "role", "phone", "whatsapp", "best_time", "note", "is_primary", "active"];
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new CrmError(400, "فیلد مخاطب نامعتبر است");
    if (key === "is_primary" || key === "active") {
      if (typeof value !== "boolean") throw new CrmError(400, "گزینهٔ مخاطب نامعتبر است");
    } else if (value !== null && typeof value !== "string") throw new CrmError(400, "متن مخاطب نامعتبر است");
  }
}


/** undefined = not being changed; null = cleared; a string = the normalised 10 digits. */
async function phoneFor(session: Session, raw: string | null | undefined, customerId: number): Promise<string | null | undefined> {
  if (raw === undefined) return undefined;
  if (!raw || !raw.trim()) return null;
  const norm = normPhone(raw);
  if (!norm) throw new CrmError(400, "شماره تلفن معتبر نیست");
  const others = (await findDuplicates(session, { phone: norm })).filter((m) => m.kind === "phone" && m.id !== customerId);
  if (others.length) throw new CrmError(409, "این شماره مال کسب‌وکار دیگری است", { matches: others });
  return norm;
}

function roleFor(raw: string | undefined): ContactRole | undefined {
  if (raw === undefined) return undefined;
  if (!isOneOf(CONTACT_ROLES, raw)) throw new CrmError(400, "سمت نامعتبر است");
  return raw;
}

/** One active primary; the business's contact_person follows it, and its phone fills the
 *  business's phone only when the business has none. */
export async function syncPrimaryMirror(db: Db, customerId: number): Promise<void> {
  const first = await db.prepare("SELECT id, is_primary FROM contacts WHERE customer_id = ? AND active = 1 ORDER BY is_primary DESC, id LIMIT 1")
    .get(customerId) as { id: number; is_primary: number } | undefined;
  if (first && !first.is_primary) await db.prepare("UPDATE contacts SET is_primary = 1 WHERE id = ?").run(first.id);
  const p = first
    ? (await db.prepare("SELECT name, phone_norm FROM contacts WHERE id = ?").get(first.id) as { name: string | null; phone_norm: string | null })
    : null;
  await db.prepare("UPDATE customers SET contact_person = ? WHERE id = ?").run(p?.name ?? null, customerId);
  if (p?.phone_norm) {
    await db.prepare("UPDATE customers SET phone = ?, phone_norm = ? WHERE id = ? AND phone_norm IS NULL").run(`0${p.phone_norm}`, p.phone_norm, customerId);
  }
}

export async function addContact(session: Session, customerId: number, input: ContactInput): Promise<{ id: number }> {
  validateInput(input);
  if (input.active === false) throw new CrmError(400, "مخاطب تازه باید فعال باشد");
  const b = await writableBusiness(session, customerId);
  const role = roleFor(input.role ?? "OTHER") as ContactRole;
  const phone = await phoneFor(session, input.phone, customerId) ?? null;
  const wa = input.whatsapp ? normPhone(input.whatsapp) : null;
  if (input.whatsapp && !wa) throw new CrmError(400, "شمارهٔ واتس‌اپ معتبر نیست");
  const db = getDb();
  const now = new Date().toISOString();
  return await db.tx(async () => {
    const id = Number((await db.prepare(`INSERT INTO contacts (organization_id, customer_id, name, role, phone, phone_norm, whatsapp, is_primary, is_decider,
                                    best_time, note, created_by, created_at, updated_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
      .run(b.organization_id, customerId, text(input.name, 80), role, phone ? `0${phone}` : null, phone, wa ? `0${wa}` : null,
        isDecider(role) ? 1 : 0, text(input.best_time, 40), text(input.note, 300), session.user.id, now, now)).lastInsertRowid);
    if (input.is_primary) {
      await db.prepare("UPDATE contacts SET is_primary = 0 WHERE customer_id = ? AND id <> ?").run(customerId, id);
      await db.prepare("UPDATE contacts SET is_primary = 1 WHERE id = ?").run(id);
    }
    await syncPrimaryMirror(db, customerId);
    return { id };
  });
}

export async function updateContact(session: Session, contactId: number, input: ContactInput, customerId: number): Promise<void> {
  validateInput(input);
  const db = getDb();
  const k = await db.prepare("SELECT customer_id FROM contacts WHERE id = ?").get(contactId) as { customer_id: number } | undefined;
  if (!k || k.customer_id !== customerId) throw new CrmError(404, "مخاطب پیدا نشد");
  await writableBusiness(session, k.customer_id);
  const role = roleFor(input.role);
  const phone = await phoneFor(session, input.phone, k.customer_id);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); vals.push(v); };
  if (input.name !== undefined) set("name", text(input.name, 80));
  if (role) { set("role", role); set("is_decider", isDecider(role) ? 1 : 0); }
  if (phone !== undefined) { set("phone", phone ? `0${phone}` : null); set("phone_norm", phone); }
  if (input.whatsapp !== undefined) {
    const wa = input.whatsapp ? normPhone(input.whatsapp) : null;
    if (input.whatsapp && !wa) throw new CrmError(400, "شمارهٔ واتس‌اپ معتبر نیست");
    set("whatsapp", wa ? `0${wa}` : null);
  }
  if (input.best_time !== undefined) set("best_time", text(input.best_time, 40));
  if (input.note !== undefined) set("note", text(input.note, 300));
  if (input.active === false) { set("active", 0); set("is_primary", 0); }
  if (input.active === true) set("active", 1);
  if (input.is_primary === false) set("is_primary", 0);
  set("updated_at", new Date().toISOString());
  await db.tx(async () => {
    const current = await db.prepare("SELECT active FROM contacts WHERE id = ? AND customer_id = ?").get(contactId, customerId) as { active: number } | undefined;
    if (!current) throw new CrmError(404, "مخاطب پیدا نشد");
    if (input.is_primary && (input.active === false || (!current.active && input.active !== true))) {
      throw new CrmError(400, "مخاطب بایگانی‌شده نمی‌تواند مخاطب اصلی باشد");
    }
    await db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, contactId);
    if (input.is_primary === false) {
      const next = await db.prepare("SELECT id FROM contacts WHERE customer_id = ? AND active = 1 AND id <> ? ORDER BY is_primary DESC, id LIMIT 1").get(k.customer_id, contactId) as { id: number } | undefined;
      if (next) await db.prepare("UPDATE contacts SET is_primary = 1 WHERE id = ?").run(next.id);
    }
    if (input.is_primary && input.active !== false) {
      await db.prepare("UPDATE contacts SET is_primary = 0 WHERE customer_id = ? AND id <> ?").run(k.customer_id, contactId);
      await db.prepare("UPDATE contacts SET is_primary = 1 WHERE id = ?").run(contactId);
    }
    await syncPrimaryMirror(db, k.customer_id);
  });
}
