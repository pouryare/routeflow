/** Staff accounts as an owner administers them. Every lookup and write names the company, so
 *  an id from another tenant is "not found" rather than an editable row. */

import { getDb, type UserRow } from "@/lib/db";

export function listUsers(organizationId: number): Record<string, unknown>[] {
  // Never password_hash: a scrypt digest is no password, but there is no reason for it to
  // cross the wire. telegram_chat_id is a live delivery address, hence the company filter.
  return getDb()
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

export function findUserInOrg(id: number, organizationId: number): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?").get(id, organizationId) as UserRow | undefined;
}

/** Would losing this owner leave the company without an active one? Other companies' owners do not count. */
export function otherActiveOwners(excludeUserId: number, organizationId: number | null): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ? AND organization_id = ?")
      .get(excludeUserId, organizationId) as { n: number }
  ).n;
}

export function usernameTakenInOrg(username: string, organizationId: number, exceptUserId: number): boolean {
  return !!getDb()
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
export function insertUser(u: NewUser): number {
  const result = getDb()
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, staff_code, phone, active, token_version, created_at, organization_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    )
    .run(u.username, u.passwordHash, u.displayName, u.role, u.groupId, u.staffCode, u.phone, new Date().toISOString(), u.organizationId);
  return Number(result.lastInsertRowid);
}

/** `sets` are fixed `column = ?` fragments from the route, never request text. */
export function updateUser(id: number, organizationId: number, sets: string[], values: (string | number | null)[]): void {
  getDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`).run(...(values as never[]), id, organizationId);
}

/** Deactivate, never delete: activity_log points at this row. The bump is what ends their session. */
export function deactivateUser(id: number, organizationId: number): void {
  getDb().prepare("UPDATE users SET active = 0, token_version = token_version + 1 WHERE id = ? AND organization_id = ?").run(id, organizationId);
}
