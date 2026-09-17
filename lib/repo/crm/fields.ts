import { getDb } from "@/lib/db";
import { canWriteBusiness, type Session } from "@/lib/session";
import { normPhone } from "@/lib/crm/phone";
import { normInstagram } from "@/lib/crm/social";
import { BUSINESS_TYPES, PRICE_TIERS, isOneOf, customerTypeFor } from "@/lib/crm/vocab";
import { isWorkingHours } from "@/lib/crm/hours";
import { getBusiness } from "./businesses";
import { findDuplicates } from "./dedupe";
import { CrmError } from "./write";
import { recomputeState } from "./state";

function writable(session: Session, id: number) {
  const b = getBusiness(session, id);
  if (!b) throw new CrmError(404, "کسب‌وکار پیدا نشد");
  if (!canWriteBusiness(session, b)) throw new CrmError(403, "دسترسی لازم را ندارید");
  return b;
}
function correction(session: Session, id: number, org: number, note: string, verified = false) {
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO activities (organization_id,customer_id,user_id,type,note,verification_to,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(org, id, session.user.id, verified ? "verification" : "correction", note, verified ? "verified" : null, now, now);
}
export function updateBusinessFields(session: Session, id: number, raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CrmError(400, "اطلاعات نامعتبر است");
  const input = raw as Record<string, unknown>;
  const allowed = ["business_name", "phone", "secondary_phone", "whatsapp", "address", "area_label", "business_type", "price_tier", "working_hours", "website", "instagram", "maps_url", "lat", "lng"];
  if (!Object.keys(input).length || Object.keys(input).some(k => !allowed.includes(k))) throw new CrmError(400, "فیلد نامعتبر است");
  const values: Record<string, string | number | null> = {};
  if ("lat" in input || "lng" in input) {
    const { lat, lng } = input;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new CrmError(400, "مختصات موقعیت معتبر نیست");
    values.lat = lat; values.lng = lng; values.location_precision = "exact";
  }
  for (const key of ["business_name", "address", "area_label", "website"] as const) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v !== null && (typeof v !== "string" || v.length > 500)) throw new CrmError(400, "متن نامعتبر است");
    values[key] = typeof v === "string" ? v.trim() || null : null;
    if (key === "business_name" && (!values[key] || String(values[key]).length < 2)) throw new CrmError(400, "نام کسب‌وکار را وارد کنید");
    if (key === "website" && values[key]) {
      try { if (!["http:", "https:"].includes(new URL(String(values[key])).protocol)) throw new Error(); }
      catch { throw new CrmError(400, "نشانی وب معتبر نیست"); }
    }
  }
  if ("phone" in input) {
    const v = input.phone;
    if (v !== null && typeof v !== "string") throw new CrmError(400, "شماره تلفن معتبر نیست");
    const p = typeof v === "string" && v.trim() ? normPhone(v) : null;
    if (typeof v === "string" && v.trim() && !p) throw new CrmError(400, "شماره تلفن معتبر نیست");
    values.phone = p ? `0${p}` : null; values.phone_norm = p;
  }
  if ("instagram" in input) {
    const v = input.instagram;
    if (v !== null && typeof v !== "string") throw new CrmError(400, "آدرس صفحهٔ اینستاگرام معتبر نیست");
    const h = typeof v === "string" && v.trim() ? normInstagram(v) : null;
    if (typeof v === "string" && v.trim() && !h) throw new CrmError(400, "آدرس صفحهٔ اینستاگرام معتبر نیست");
    values.instagram = h;
  }
  if ("maps_url" in input) {
    const v = input.maps_url;
    if (v !== null && typeof v !== "string") throw new CrmError(400, "پیوند نقشه معتبر نیست");
    if (typeof v === "string" && v.trim()) {
      try { if (!["http:", "https:"].includes(new URL(v.trim()).protocol)) throw new Error(); }
      catch { throw new CrmError(400, "پیوند نقشه معتبر نیست"); }
      values.maps_url = v.trim().slice(0, 500);
    } else values.maps_url = null;
  }
  for (const key of ["secondary_phone", "whatsapp"] as const) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v !== null && typeof v !== "string") throw new CrmError(400, "شماره تلفن معتبر نیست");
    const p = typeof v === "string" && v.trim() ? normPhone(v) : null;
    if (typeof v === "string" && v.trim() && !p) throw new CrmError(400, "شماره تلفن معتبر نیست");
    values[key] = p ? `0${p}` : null;
  }
  if ("business_type" in input) {
    if (!isOneOf(BUSINESS_TYPES, input.business_type)) throw new CrmError(400, "نوع کسب‌وکار نامعتبر است");
    values.business_type = input.business_type; values.customer_type = customerTypeFor(input.business_type);
  }
  if ("price_tier" in input) {
    if (!isOneOf(PRICE_TIERS, input.price_tier)) throw new CrmError(400, "ردهٔ قیمت نامعتبر است");
    values.price_tier = input.price_tier;
  }
  if ("working_hours" in input) {
    if (input.working_hours !== null && !isWorkingHours(input.working_hours)) throw new CrmError(400, "ساعت کاری نامعتبر است");
    values.working_hours_json = input.working_hours === null ? null : JSON.stringify(input.working_hours);
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const b = writable(session, id), org = b.organization_id;
    if (values.phone_norm && db.prepare(`SELECT id FROM customers WHERE organization_id = ? AND id <> ? AND merged_into_id IS NULL
      AND (phone_norm = ? OR id IN (SELECT customer_id FROM contacts WHERE organization_id = ? AND active = 1 AND phone_norm = ?)) LIMIT 1`)
      .get(org, id, values.phone_norm, org, values.phone_norm)) throw new CrmError(409, "این شماره مال کسب‌وکار دیگری است");
    if (typeof values.instagram === "string" && values.instagram) {
      const others = findDuplicates(session, { instagram: values.instagram }).filter(m => m.kind === "instagram" && m.id !== id);
      if (others.length) throw new CrmError(409, "این صفحهٔ اینستاگرام مال کسب‌وکار دیگری است", { matches: others });
    }
    if (session.role === "salesperson" && b.owner_user_id === null) values.owner_user_id = session.user.id;
    db.prepare(`UPDATE customers SET ${Object.keys(values).map(k => `${k} = ?`).join(",")} WHERE id = ? AND organization_id = ?`).run(...Object.values(values), id, org);
    correction(session, id, org, "اطلاعات کسب‌وکار اصلاح شد");
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
export function verifyBusiness(session: Session, id: number): void {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const b = writable(session, id);
    if (b.closed_at) throw new CrmError(400, "کسب‌وکار بسته شده است");
    if (b.verification !== "verified") {
      correction(session, id, b.organization_id, "اطلاعات کسب‌وکار تأیید شد", true);
      recomputeState(db, id);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
