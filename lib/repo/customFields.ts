import { getDb } from "@/lib/db";
import { checkValue, isFieldKind, MAX_ACTIVE_FIELDS, parseChoices, parseName, type FieldDef } from "@/lib/customFields";

interface Row { id: number; name: string; kind: string; choices: string | null; archived_at: string | null }
const def = (r: Row): FieldDef => ({ id: Number(r.id), name: r.name, kind: r.kind as FieldDef["kind"], choices: r.choices ? (JSON.parse(r.choices) as string[]) : [] });

/** The company's active fields, in the order they were made. */
export async function activeFields(orgId: number): Promise<FieldDef[]> {
  const rows = (await getDb().prepare("SELECT id, name, kind, choices, archived_at FROM custom_fields WHERE organization_id = ? AND archived_at IS NULL ORDER BY sort_order, id").all(orgId)) as unknown as Row[];
  return rows.map(def);
}

/** The reason a new field is refused, or null once it is saved. */
export async function createField(orgId: number, body: { name?: unknown; kind?: unknown; choices?: unknown }): Promise<string | null> {
  const name = parseName(body.name);
  if (!name) return "نام ویژگی ۱ تا ۴۰ حرف است";
  if (!isFieldKind(body.kind)) return "نوع ویژگی نامعتبر است";
  let choices: string[] | null = null;
  if (body.kind === "choice") {
    choices = parseChoices(body.choices);
    if (!choices) return "یک ویژگی انتخابی ۲ تا ۱۲ گزینهٔ متفاوت می‌خواهد (هر کدام تا ۳۰ حرف)";
  }
  const db = getDb();
  const active = await activeFields(orgId);
  if (active.length >= MAX_ACTIVE_FIELDS) return `حداکثر ${MAX_ACTIVE_FIELDS.toLocaleString("fa-IR")} ویژگی فعال می‌شود؛ یکی را بایگانی کنید`;
  if (active.some((f) => f.name === name)) return "ویژگی‌ای با این نام هست";
  await db
    .prepare("INSERT INTO custom_fields (organization_id, name, kind, choices, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(orgId, name, body.kind, choices ? JSON.stringify(choices) : null, active.length, new Date().toISOString());
  return null;
}

/** Rename a field, or archive it (its values stay, hidden). The reason it is refused, or null. */
export async function updateField(orgId: number, id: number, body: { name?: unknown; archived?: unknown }): Promise<string | null> {
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM custom_fields WHERE id = ? AND organization_id = ? AND archived_at IS NULL").get(id, orgId))) return "ویژگی پیدا نشد";
  if (body.archived === true) {
    await db.prepare("UPDATE custom_fields SET archived_at = ? WHERE id = ? AND organization_id = ?").run(new Date().toISOString(), id, orgId);
    return null;
  }
  const name = parseName(body.name);
  if (!name) return "نام ویژگی ۱ تا ۴۰ حرف است";
  if ((await activeFields(orgId)).some((f) => f.name === name && f.id !== id)) return "ویژگی‌ای با این نام هست";
  await db.prepare("UPDATE custom_fields SET name = ? WHERE id = ? AND organization_id = ?").run(name, id, orgId);
  return null;
}

export interface FieldWithValue extends FieldDef { value: string | null }

/** Every active field with this customer's value (null when empty). */
export async function valuesFor(orgId: number, customerId: number): Promise<FieldWithValue[]> {
  const fields = await activeFields(orgId);
  if (fields.length === 0) return [];
  const rows = (await getDb().prepare("SELECT field_id, value FROM custom_field_values WHERE organization_id = ? AND customer_id = ?").all(orgId, customerId)) as unknown as { field_id: number; value: string }[];
  const by = new Map(rows.map((r) => [Number(r.field_id), r.value]));
  return fields.map((f) => ({ ...f, value: by.get(f.id) ?? null }));
}

/** Save values { fieldId: value | null } for one customer, all or none. The reason it is refused, or null. */
export async function setValues(orgId: number, customerId: number, values: unknown): Promise<string | null> {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "درخواست نامعتبر است";
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(customerId, orgId))) return "مشتری پیدا نشد";
  const fields = new Map((await activeFields(orgId)).map((f) => [f.id, f]));
  const checked: [number, string | null][] = [];
  for (const [k, raw] of Object.entries(values as Record<string, unknown>)) {
    const f = fields.get(Number(k));
    if (!f) return "ویژگی پیدا نشد";
    const v = checkValue(f, raw);
    if (v !== null && typeof v === "object") return `${f.name}: ${v.error}`;
    checked.push([f.id, v]);
  }
  const now = new Date().toISOString();
  for (const [fieldId, v] of checked) {
    if (v === null) await db.prepare("DELETE FROM custom_field_values WHERE customer_id = ? AND field_id = ? AND organization_id = ?").run(customerId, fieldId, orgId);
    else
      await db
        .prepare(
          `INSERT INTO custom_field_values (organization_id, customer_id, field_id, value, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (customer_id, field_id) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
        )
        .run(orgId, customerId, fieldId, v, now);
  }
  return null;
}
