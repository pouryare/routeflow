import { getDb } from "@/lib/db";

export interface ContentImageRow {
  id: number;
  organization_id: number;
  file_stem: string;
}

/** Records one picture used in a lesson or on a product; the bytes are in the company's storage. */
export async function addContentImage(organizationId: number, stem: string, userId: number): Promise<number> {
  const r = await getDb()
    .prepare("INSERT INTO content_images (organization_id, file_stem, created_by, created_at) VALUES (?, ?, ?, ?)")
    .run(organizationId, stem, userId, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export async function findContentImage(organizationId: number, id: number): Promise<ContentImageRow | null> {
  return ((await getDb().prepare("SELECT id, organization_id, file_stem FROM content_images WHERE id = ? AND organization_id = ?").get(id, organizationId)) as ContentImageRow | undefined) ?? null;
}
