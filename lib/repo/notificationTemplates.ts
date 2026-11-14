import { getDb } from "@/lib/db";
import { templateProblem } from "@/lib/messageTemplate";

export interface TemplateRow { type_code: string; title_fa: string; body_fa: string | null }

export async function templatesOf(orgId: number): Promise<TemplateRow[]> {
  return (await getDb().prepare("SELECT type_code, title_fa, body_fa FROM notification_templates WHERE organization_id = ?").all(orgId)) as unknown as TemplateRow[];
}

export async function templateFor(orgId: number, typeCode: string): Promise<TemplateRow | null> {
  return ((await getDb().prepare("SELECT type_code, title_fa, body_fa FROM notification_templates WHERE organization_id = ? AND type_code = ?").get(orgId, typeCode)) as TemplateRow | undefined) ?? null;
}

/** Saves a wording, or with title null restores the shipped text. Returns the problem in words, or null once saved. */
export async function setTemplate(orgId: number, typeCode: string, title: string | null, body: string | null, by: number): Promise<string | null> {
  const db = getDb();
  if (title === null) {
    await db.prepare("DELETE FROM notification_templates WHERE organization_id = ? AND type_code = ?").run(orgId, typeCode);
    return null;
  }
  const problem = templateProblem(typeCode, title, body);
  if (problem) return problem;
  await db
    .prepare(
      `INSERT INTO notification_templates (organization_id, type_code, title_fa, body_fa, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, type_code) DO UPDATE SET title_fa = EXCLUDED.title_fa, body_fa = EXCLUDED.body_fa, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`
    )
    .run(orgId, typeCode, title.trim(), body?.trim() || null, by, new Date().toISOString());
  return null;
}
