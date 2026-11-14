import { getDb } from "@/lib/db";
import { canonicalQuery, viewNameProblem } from "@/lib/savedViews";

export interface SavedView { id: number; name: string; query: string }

export class ViewError extends Error {}

export async function listViews(organizationId: number, userId: number, scope = "orders"): Promise<SavedView[]> {
  const rows = (await getDb()
    .prepare("SELECT id, name, query FROM saved_views WHERE organization_id = ? AND user_id = ? AND scope = ? ORDER BY created_at, id")
    .all(organizationId, userId, scope)) as { id: number; name: string; query: string }[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name, query: r.query }));
}

/** Save a new view, or change the filter of one of the person's own views (`id`). Views stay personal. */
export async function saveView(organizationId: number, userId: number, input: { id?: number; name?: string; query: string }, scope = "orders"): Promise<number> {
  const query = canonicalQuery(input.query);
  if (!query) throw new ViewError("اول یک فیلتر بگذارید");
  const db = getDb();
  if (input.id) {
    const res = await db.prepare("UPDATE saved_views SET query = ? WHERE id = ? AND organization_id = ? AND user_id = ? AND scope = ?").run(query, input.id, organizationId, userId, scope);
    if (!res.changes) throw new ViewError("این نما پیدا نشد");
    return input.id;
  }
  const problem = viewNameProblem(input.name ?? "");
  if (problem) throw new ViewError(problem);
  const exists = await db.prepare("SELECT 1 AS ok FROM saved_views WHERE user_id = ? AND scope = ? AND name = ?").get(userId, scope, (input.name ?? "").trim());
  if (exists) throw new ViewError("نمایی با این نام دارید");
  const res = await db
    .prepare("INSERT INTO saved_views (organization_id, user_id, scope, name, query, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(organizationId, userId, scope, (input.name ?? "").trim(), query, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export async function deleteView(organizationId: number, userId: number, id: number): Promise<void> {
  await getDb().prepare("DELETE FROM saved_views WHERE id = ? AND organization_id = ? AND user_id = ?").run(id, organizationId, userId);
}
