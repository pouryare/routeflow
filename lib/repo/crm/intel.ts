import { getDb } from "@/lib/db";
import { type Session } from "@/lib/session";
import { normalisePersian } from "@/lib/persian";
import { replayAnswers, FlowError } from "@/lib/crm/flows/machine";
import { intelFlow } from "@/lib/crm/flows/intel";
import type { FlowAnswer } from "@/lib/crm/flows/types";
import { flowContextFor } from "./businesses";
import { CrmError, writableBusiness } from "./write";

const bad = () => new CrmError(400, "اطلاعات شناخت نامعتبر است");
export async function applyIntel(session: Session, id: number, raw: unknown): Promise<{ activityId: number }> {
  await writableBusiness(session, id);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad();
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.answers) || input.answers.length !== 5) throw bad();
  if (input.answers.some(a => !a || typeof a !== "object" || typeof a.step !== "string" || typeof a.option !== "string" || (a.value !== undefined && (typeof a.value !== "string" || a.value.length > 1000)))) throw bad();
  const uuid = input.clientUuid ?? null;
  if (uuid !== null && (typeof uuid !== "string" || !uuid.trim() || uuid.length > 100)) throw bad();
  const fc = (await flowContextFor(session, id, "call"))!;
  let st: import("@/lib/crm/flows/types").FlowState;
  try { st = replayAnswers(intelFlow, fc.ctx, input.answers as FlowAnswer[]); }
  catch (e) { if (e instanceof FlowError) throw bad(); throw e; }
  if (!st.saved) throw bad();
  const offered = new Set(fc.ctx.products.map(p => p.id));
  const uses = st.values.uses ? [...new Set(st.values.uses.split(",").map(Number))] : [];
  if (uses.some(p => !Number.isSafeInteger(p) || !offered.has(p))) throw bad();
  const note = st.values.visit_note?.trim() || null;
  if (note && note.length > 500) throw bad();
  const known = (v: string | undefined) => v && v !== "unknown" ? v : null;
  const db = getDb(), at = new Date().toISOString();
  return await save();
  async function save() {
    await db.exec("BEGIN IMMEDIATE");
    try {
      const b = await writableBusiness(session, id);
      if (uuid) {
        const prior = await db.prepare("SELECT id,customer_id,type FROM activities WHERE organization_id=? AND client_uuid=?").get(b.organization_id, uuid as string) as { id: number; customer_id: number; type: string } | undefined;
        if (prior) {
          if (prior.customer_id !== id || prior.type !== "note") throw new CrmError(409, "شناسهٔ درخواست تکراری است");
          await db.exec("COMMIT"); return { activityId: prior.id };
        }
      }
      await db.prepare(`UPDATE customers SET size_band=COALESCE(?,size_band), supply_channel=COALESCE(?,supply_channel), visit_window=COALESCE(?,visit_window), visit_note=COALESCE(?,visit_note), uses_products_json=COALESCE(?,uses_products_json) WHERE id=? AND organization_id=?`)
        .run(known(st.acc.size_band), known(st.acc.supply_channel), known(st.acc.visit_window), note, uses.length ? JSON.stringify(uses) : null, id, b.organization_id);
      const activityId = Number((await db.prepare("INSERT INTO activities (organization_id,customer_id,user_id,type,note,answers_json,client_uuid,occurred_at,created_at) VALUES (?,?,?,'note',?,?,?,?,?)")
        .run(b.organization_id,id,session.user.id,"شناخت پیش از بازدید",JSON.stringify({ answers: input.answers }),uuid as string | null,at,at)).lastInsertRowid);
      await db.prepare("UPDATE customers SET last_activity_at=? WHERE id=?").run(at,id);
      await db.exec("COMMIT"); return { activityId };
    } catch (e) { await db.exec("ROLLBACK"); throw e; }
  }
}

export async function updateTags(session: Session, id: number, raw: unknown): Promise<void> {
  const b = await writableBusiness(session,id);
  if (!Array.isArray(raw) || raw.length > 20 || raw.some(t => typeof t !== "string" || !t.trim() || t.length > 50)) throw new CrmError(400,"برچسب نامعتبر است");
  const tags = [...new Set((raw as string[]).map(t => normalisePersian(t).trim()))];
  const db = getDb();
  await db.exec("BEGIN IMMEDIATE");
  try {
    await db.prepare("DELETE FROM customer_tags WHERE customer_id=? AND organization_id=?").run(id,b.organization_id);
    const insert = db.prepare("INSERT INTO customer_tags (organization_id,customer_id,tag,created_at) VALUES (?,?,?,?)");
    for (const tag of tags) await insert.run(b.organization_id,id,tag,new Date().toISOString());
    await db.exec("COMMIT");
  } catch (e) { await db.exec("ROLLBACK"); throw e; }
}
