import { getDb, UserRow } from "./db";
import { hashPassword } from "./auth";

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const db = getDb();
  return (await db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined) ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return (await getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export async function createUser(username: string, password: string, displayName: string): Promise<UserRow> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, hashPassword(password), displayName, now);
  return (await findUserByUsername(username))!;
}
