import { getDb } from "@/lib/db";
import type { EntryPlace } from "@/lib/entryPlace";

/** Z9: keep where the entry was made. A repeat (an outbox resend) keeps the first place. */
export async function saveEntryPlace(organizationId: number, kind: "payment" | "expense", refId: number, p: EntryPlace | null): Promise<void> {
  if (!p) return;
  await getDb()
    .prepare(
      `INSERT INTO entry_places (organization_id, kind, ref_id, lat, lng, accuracy_m, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (organization_id, kind, ref_id) DO NOTHING`
    )
    .run(organizationId, kind, refId, p.lat, p.lng, p.accuracy_m, new Date().toISOString());
}

/** The places of these entries, by ref id. */
export async function entryPlacesFor(organizationId: number, kind: "payment" | "expense", ids: readonly number[]): Promise<Map<number, { lat: number; lng: number }>> {
  if (ids.length === 0) return new Map();
  const rows = (await getDb()
    .prepare(`SELECT ref_id, lat, lng FROM entry_places WHERE organization_id = ? AND kind = ? AND ref_id IN (${ids.map(() => "?").join(", ")})`)
    .all(organizationId, kind, ...ids)) as { ref_id: number; lat: number; lng: number }[];
  return new Map(rows.map((r) => [Number(r.ref_id), { lat: Number(r.lat), lng: Number(r.lng) }]));
}
