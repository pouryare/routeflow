import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-chat-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { cleanBody, canChat, MAX_CHAT_CHARS } = await import("@/lib/chat");
const { postMessage, threadOf, unreadIn, markRead } = await import("@/lib/repo/chat");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("FB9 chat text and roles", () => {
  it("trims, refuses empty and too long text", () => {
    expect(cleanBody("  سلام  ")).toBe("سلام");
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody("x".repeat(MAX_CHAT_CHARS + 1))).toBeNull();
    expect(cleanBody(5)).toBeNull();
  });
  it("lets sellers and drivers chat but not shareholders", () => {
    expect(canChat("phone_sales")).toBe(true);
    expect(canChat("delivery_driver")).toBe(true);
    expect(canChat("shareholder")).toBe(false);
  });
});

describe("FB9 thread", () => {
  it("saves once per key, counts unread for the other person and clears on read", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (name: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x',?,'owner',1,?,1)").run(name, name, now)).lastInsertRowid);
    const a = await mk("a"), b = await mk("b");
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('CH','گفتگو','active',?,1)").run(now)).lastInsertRowid);
    const sa = { organizationId: 1, user: { id: a, display_name: "a" } } as never;
    const sb = { organizationId: 1, user: { id: b, display_name: "b" } } as never;
    const first = await postMessage(sa, "customer", cust, "سلام", "key-aaaaaaaa");
    expect(await postMessage(sa, "customer", cust, "سلام", "key-aaaaaaaa")).toBe(first); // a retry saves once
    await postMessage(sa, "customer", cust, "دوم", null);
    expect(await threadOf(1, "customer", cust, null)).toHaveLength(2);
    expect(await unreadIn(sa, "customer", cust)).toBe(0); // own messages are read
    expect(await unreadIn(sb, "customer", cust)).toBe(2);
    expect((await threadOf(1, "customer", cust, first)).map((m) => m.body)).toEqual(["دوم"]);
    await markRead(sb, "customer", cust, first);
    expect(await unreadIn(sb, "customer", cust)).toBe(1);
    expect(await threadOf(2, "customer", cust, null)).toHaveLength(0); // another company sees nothing
  });
});
