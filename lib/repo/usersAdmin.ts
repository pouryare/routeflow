/** Staff accounts as an owner administers them. Every lookup and write names the company, so
 *  an id from another tenant is "not found" rather than an editable row. */

import { getDb, type UserRow } from "@/lib/db";

export async function listUsers(organizationId: number): Promise<Record<string, unknown>[]> {
  // Never password_hash: a scrypt digest is no password, but there is no reason for it to
  // cross the wire. telegram_chat_id is a live delivery address, hence the company filter.
  return await getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.group_id, u.staff_code, u.phone,
              u.telegram_chat_id, u.active, u.location_consent_at, u.created_at,
              u.avatar_url, g.name AS group_name
       FROM users u LEFT JOIN groups g ON g.id = u.group_id
       WHERE u.organization_id = ?
       ORDER BY u.active DESC, u.display_name`
    )
    .all(organizationId) as unknown as Record<string, unknown>[];
}

export async function findUserInOrg(id: number, organizationId: number): Promise<UserRow | undefined> {
  return await getDb().prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?").get(id, organizationId) as UserRow | undefined;
}

/** Would losing this owner leave the company without an active one? Other companies' owners do not count. */
export async function otherActiveOwners(excludeUserId: number, organizationId: number | null): Promise<number> {
  return (
    await getDb()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ? AND organization_id = ?")
      .get(excludeUserId, organizationId) as { n: number }
  ).n;
}

export async function usernameTakenInOrg(username: string, organizationId: number, exceptUserId: number): Promise<boolean> {
  return !!await getDb()
    .prepare("SELECT 1 FROM users WHERE username = ? AND organization_id = ? AND id != ?")
    .get(username, organizationId, exceptUserId);
}

export interface NewUser {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  groupId: number | null;
  staffCode: string | null;
  phone: string | null;
  organizationId: number;
}

/** Throws the database's UNIQUE error on a taken username; callers map it to a 409. */
export async function insertUser(u: NewUser): Promise<number> {
  const result = await getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, staff_code, phone, active, token_version, created_at, organization_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 1)`
    )
    .run(u.username, u.passwordHash, u.displayName, u.role, u.groupId, u.staffCode, u.phone, new Date().toISOString(), u.organizationId);
  return Number(result.lastInsertRowid);
}

/** A person replaced their own password (F35): store it, clear the "must change" mark, and end
 *  every other session. Returns the new token version for the cookie this device keeps. */
export async function setOwnPassword(id: number, passwordHash: string): Promise<number> {
  const row = await getDb()
    .prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ? RETURNING token_version"
    )
    .get(passwordHash, id) as { token_version: number } | undefined;
  return row?.token_version ?? 0;
}

/** `sets` are fixed `column = ?` fragments from the route, never request text. */
export async function updateUser(id: number, organizationId: number, sets: string[], values: (string | number | null)[]): Promise<void> {
  await getDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`).run(...(values as never[]), id, organizationId);
}

/** Deactivate, never delete: activity_log points at this row. The bump is what ends their session. */
export async function deactivateUser(id: number, organizationId: number): Promise<void> {
  await getDb().prepare("UPDATE users SET active = 0, token_version = token_version + 1 WHERE id = ? AND organization_id = ?").run(id, organizationId);
}
