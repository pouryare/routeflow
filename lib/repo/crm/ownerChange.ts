import type { DatabaseSync } from "node:sqlite";

/** F100: one way to record that a customer changed hands, so every path that moves a customer
 *  leaves the same `owner_change` entry on its timeline: what moved (the salesperson or the
 *  group), from whom to whom, and why. Names are written into the note when it happens, so a
 *  later rename or a deleted group does not rewrite the history. `actorUserId` null means the
 *  system did it (a territory recompute). */

export type OwnerChangeReason = "pool_claim" | "territory";

const REASON_LABEL: Record<OwnerChangeReason, string> = {
  pool_claim: "برداشتن از استخر گروه",
  territory: "تغییر محدودهٔ گروه‌ها",
};

const NOBODY = "بدون مسئول";
const NO_GROUP = "بدون گروه";

function nameOf(db: DatabaseSync, table: "users" | "groups", id: number | null): string | null {
  if (id === null) return null;
  const col = table === "users" ? "display_name" : "name";
  const row = db.prepare(`SELECT ${col} AS name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined;
  return row?.name ?? `#${id}`;
}

/** The note the timeline shows: «برداشتن از استخر گروه · مسئول: از «بدون مسئول» به «سارا»». */
export function ownerChangeNote(
  reason: OwnerChangeReason,
  what: "owner" | "group",
  from: string | null,
  to: string | null
): string {
  const label = what === "owner" ? "مسئول" : "گروه";
  const empty = what === "owner" ? NOBODY : NO_GROUP;
  return `${REASON_LABEL[reason]} · ${label}: از «${from ?? empty}» به «${to ?? empty}»`;
}

export function recordOwnerChange(
  db: DatabaseSync,
  input: {
    organizationId: number;
    customerId: number;
    actorUserId: number | null;
    reason: OwnerChangeReason;
    what: "owner" | "group";
    fromId: number | null;
    toId: number | null;
    at?: string;
  }
): void {
  const table = input.what === "owner" ? "users" : "groups";
  const note = ownerChangeNote(input.reason, input.what, nameOf(db, table, input.fromId), nameOf(db, table, input.toId));
  const at = input.at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO activities (organization_id, customer_id, user_id, type, note, occurred_at, created_at)
     VALUES (?, ?, ?, 'owner_change', ?, ?, ?)`
  ).run(input.organizationId, input.customerId, input.actorUserId, note, at, new Date().toISOString());
}
