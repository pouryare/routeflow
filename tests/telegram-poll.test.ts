import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-tg-link-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { consumeTelegramStart } = await import("@/lib/repo/telegramLink");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let withNonce = 0,
  noNonce = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec("PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;");
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id,telegram_link_nonce) VALUES (?,?,?,?,1,?,1,?)"
  );
  withNonce = Number((await u.run(`a${Date.now()}`, "x:y", "الف", "phone_sales", now, "abc")).lastInsertRowid);
  // A second user with no pending link at all — the nonce lookup must never reach it.
  noNonce = Number((await u.run(`b${Date.now()}`, "x:y", "ب", "phone_sales", now, null)).lastInsertRowid);
});

async function userRow(id: number) {
  return await getDb()
    .prepare("SELECT telegram_chat_id, telegram_link_nonce FROM users WHERE id = ?")
    .get(id) as { telegram_chat_id: string | null; telegram_link_nonce: string | null };
}

describe("consumeTelegramStart", () => {
  it("links the user whose nonce matches, stamps the chat id, and clears the nonce", async () => {
    const r = await consumeTelegramStart(getDb(), "/start abc", "999");
    expect(r).toEqual({ linked: true, userId: withNonce });
    expect(await userRow(withNonce)).toEqual({ telegram_chat_id: "999", telegram_link_nonce: null });
  });

  it("is idempotent — a replayed /start with the now-cleared nonce does not re-link", async () => {
    expect((await consumeTelegramStart(getDb(), "/start abc", "999")).linked).toBe(true);
    const second = await consumeTelegramStart(getDb(), "/start abc", "666");
    expect(second).toEqual({ linked: false });
    // The replay must not repoint the account at the second chat.
    expect((await userRow(withNonce)).telegram_chat_id).toBe("999");
  });

  it("ignores a message that is not a /start command", async () => {
    expect(await consumeTelegramStart(getDb(), "hello", "999")).toEqual({ linked: false });
    expect((await userRow(withNonce)).telegram_chat_id).toBeNull();
  });

  it("ignores /start with an empty nonce", async () => {
    expect(await consumeTelegramStart(getDb(), "/start ", "999")).toEqual({ linked: false });
    expect(await consumeTelegramStart(getDb(), "/start", "999")).toEqual({ linked: false });
    expect((await userRow(withNonce)).telegram_chat_id).toBeNull();
  });

  it("never matches a user whose telegram_link_nonce is NULL", async () => {
    // The regex yields the literal strings "null"/"NULL"/"undefined"; none may reach a NULL row.
    for (const probe of ["/start null", "/start NULL", "/start undefined"]) {
      expect(await consumeTelegramStart(getDb(), probe, "999")).toEqual({ linked: false });
    }
    expect(await userRow(noNonce)).toEqual({ telegram_chat_id: null, telegram_link_nonce: null });
  });

  it("tolerates surrounding whitespace and ignores trailing words", async () => {
    const r = await consumeTelegramStart(getDb(), "  /start abc extra\n", "55384695");
    expect(r).toEqual({ linked: true, userId: withNonce });
    expect((await userRow(withNonce)).telegram_chat_id).toBe("55384695");
  });
});
