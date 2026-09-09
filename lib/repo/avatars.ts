import { getDb, Photo } from "@/lib/db";

/** User avatars share the `photos` table (entity_type='user') rather than a dedicated
 *  one -- see the 2026-09-09 user-avatars plan. Not a tenant repo (`makeRepo`'s
 *  `{ tenant: true }` mode): `photos` carries no `organization_id` column of its own,
 *  so the org boundary for viewing is enforced one level up, against the target user's
 *  own `organization_id`, not against this table directly (see `getUserOrgId` below and
 *  `lib/avatarAccess.ts`'s `canViewUserAvatar`). The hand-written SQL here, inside
 *  `lib/repo/`, is the sanctioned form per `lib/repo/README.md` for a shape `makeRepo`
 *  cannot express -- a singleton "one row per user" lookup and a delete-then-insert
 *  transaction, not a plain by-id CRUD. */

export function getUserAvatar(userId: number): Photo | undefined {
  return getDb()
    .prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?")
    .get(userId) as Photo | undefined;
}

/** Deletes any existing avatar row for `userId` and inserts a new one, in one
 *  transaction -- the app-layer half of the "at most one avatar per user" guarantee
 *  the partial UNIQUE index (`idx_photos_user_singleton`) enforces at the DB layer.
 *  Returns the new row's id and the REPLACED row's file_stem (if any), so the caller
 *  can unlink its files after the DB transaction has already committed. */
export function replaceUserAvatar(
  userId: number,
  fileStem: string,
  now: string,
): { id: number; priorFileStem: string | null } {
  const db = getDb();
  const prior = db
    .prepare("SELECT file_stem FROM photos WHERE entity_type='user' AND entity_id=?")
    .get(userId) as { file_stem: string } | undefined;

  let insertedId: number;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM photos WHERE entity_type='user' AND entity_id=?").run(userId);
    const result = db
      .prepare(
        "INSERT INTO photos (entity_type, entity_id, file_stem, taken_at, created_at) VALUES ('user', ?, ?, ?, ?)"
      )
      .run(userId, fileStem, now, now);
    insertedId = Number(result.lastInsertRowid);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { id: insertedId, priorFileStem: prior?.file_stem ?? null };
}

/** Deletes the user's avatar row, if any, and returns it (so the caller can unlink its
 *  files) -- undefined when there was nothing to delete, which callers treat as a
 *  harmless no-op rather than an error. */
export function deleteUserAvatar(userId: number): Photo | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?")
    .get(userId) as Photo | undefined;
  if (!row) return undefined;
  db.prepare("DELETE FROM photos WHERE id = ?").run(row.id);
  return row;
}

/** The organization a user belongs to -- the boundary canViewUserAvatar checks against.
 *  undefined for a user id that does not exist (the route then 404s, matching every
 *  other "not found vs not allowed, never distinguished" 404 in this codebase). */
export function getUserOrgId(userId: number): number | undefined {
  const row = getDb().prepare("SELECT organization_id FROM users WHERE id = ?").get(userId) as
    | { organization_id: number }
    | undefined;
  return row?.organization_id;
}
