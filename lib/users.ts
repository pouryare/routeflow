import { getDb, UserRow } from "./db";
import { hashPassword } from "./auth";

export function findUserByUsername(username: string): UserRow | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined) ?? null;
}

export function findUserById(id: number): UserRow | null {
  return (getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function createUser(username: string, password: string, displayName: string): UserRow {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, hashPassword(password), displayName, now);
  return findUserByUsername(username)!;
}
