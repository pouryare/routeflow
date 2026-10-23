import { getDb } from "@/lib/db";

/** F107: end every session a user has. Each session cookie carries a snapshot of
 *  `users.token_version` and lib/session.ts refuses one that no longer matches, so raising the
 *  number signs the user out on every device at once. Returns the new number, so the caller
 *  can re-issue the cookie on the device that asked and keep it signed in. */
export async function bumpTokenVersion(userId: number): Promise<number> {
  const db = getDb();
  await db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(userId);
  return (await db.prepare("SELECT token_version FROM users WHERE id = ?").get(userId) as { token_version: number }).token_version;
}
