/* Migration era 08: the founder's second login step. A TOTP secret (encrypted at rest), when it was
 * switched on, the last time step accepted (so a code cannot be replayed), and one-time recovery codes. */
import type { DatabaseSync } from "node:sqlite";

export function applyFounderSecondFactor(db: DatabaseSync): void {
  const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("totp_secret")) db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
  if (!cols.includes("totp_enabled_at")) db.exec("ALTER TABLE users ADD COLUMN totp_enabled_at TEXT");
  if (!cols.includes("totp_last_step")) db.exec("ALTER TABLE users ADD COLUMN totp_last_step INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_user ON user_recovery_codes(user_id);
  `);
}
