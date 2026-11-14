import { getDb } from "@/lib/db";
import { filterProblem, type FilterNode } from "@/lib/filterSpec";
import { CUSTOMER_FILTER_MENU } from "@/lib/customerFilterMenu";

export interface Segment { id: number; name: string; spec: FilterNode }

export async function listSegments(orgId: number): Promise<Segment[]> {
  const rows = (await getDb().prepare("SELECT id, name, spec FROM customer_segments WHERE organization_id = ? ORDER BY name").all(orgId)) as unknown as { id: number; name: string; spec: string }[];
  return rows.flatMap((r) => { try { return [{ id: Number(r.id), name: r.name, spec: JSON.parse(r.spec) as FilterNode }]; } catch { return []; } });
}

export async function segmentSpec(orgId: number, id: number): Promise<FilterNode | null> {
  return (await listSegments(orgId)).find((s) => s.id === id)?.spec ?? null;
}

/** Saves a filter under a name (a same-named one is replaced). Returns the problem in words, or null once saved. */
export async function saveSegment(orgId: number, userId: number, name: string, spec: unknown): Promise<string | null> {
  const n = name.trim();
  if (n === "" || n.length > 60) return "نام بخش باید بین ۱ تا ۶۰ نویسه باشد";
  const problem = filterProblem(spec, CUSTOMER_FILTER_MENU);
  if (problem) return problem;
  await getDb()
    .prepare("INSERT INTO customer_segments (organization_id, name, spec, created_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (organization_id, name) DO UPDATE SET spec = EXCLUDED.spec")
    .run(orgId, n, JSON.stringify(spec), userId, new Date().toISOString());
  return null;
}

export async function deleteSegment(orgId: number, id: number): Promise<void> {
  await getDb().prepare("DELETE FROM customer_segments WHERE id = ? AND organization_id = ?").run(id, orgId);
}
