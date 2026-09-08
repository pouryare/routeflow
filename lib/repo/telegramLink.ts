import type { DatabaseSync } from "node:sqlite";

/** Telegram account linking, deliberately kept in its own module with a TYPE-ONLY import.
 *
 *  `scripts/telegram-poll.ts` runs standalone under `node --experimental-strip-types`,
 *  which erases the import above and leaves this file with no runtime dependency at all.
 *  It cannot live in lib/repo/notifications.ts: that module imports `@/lib/db` and friends,
 *  and bare node resolves neither the `@/` alias nor lib/db.ts's own extensionless relative
 *  imports. Keeping it here means the worker and the tests share ONE implementation instead
 *  of a hand-synced copy. Raw SQL belongs under lib/repo/ (tests/repo-boundary.test.ts).
 */

/** Redeem a `/start <nonce>` deep link: bind the sender's chat id to whichever user minted
 *  that nonce, then burn the nonce so the link cannot be replayed.
 *
 *  Idempotent by construction — clearing `telegram_link_nonce` in the same statement that
 *  stamps the chat id means a second delivery of the same update (Telegram retries until
 *  the offset is acknowledged) finds no row and returns `{ linked: false }`.
 *
 *  `telegram_link_nonce` has no UNIQUE constraint. `mintTelegramNonce` draws 16 random
 *  bytes, so a collision is not a practical concern; if one ever happened, `.get()` would
 *  bind an arbitrary one of the two and the loser would simply re-request a link.
 */
export function consumeTelegramStart(
  db: DatabaseSync,
  text: string,
  chatId: string
): { linked: boolean; userId?: number } {
  const m = /^\/start\s+(\S+)/.exec(text.trim());
  if (!m) return { linked: false };
  // `IS NOT NULL` is belt-and-braces: `\S+` cannot capture an empty string, and SQL
  // equality never matches NULL, so a user with no pending link is unreachable either way.
  const row = db
    .prepare("SELECT id FROM users WHERE telegram_link_nonce = ? AND telegram_link_nonce IS NOT NULL")
    .get(m[1]) as { id: number } | undefined;
  if (!row) return { linked: false };
  db.prepare("UPDATE users SET telegram_chat_id = ?, telegram_link_nonce = NULL WHERE id = ?").run(chatId, row.id);
  return { linked: true, userId: row.id };
}
