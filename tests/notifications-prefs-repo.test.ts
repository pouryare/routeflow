import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-prefs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
// Real VAPID keypair (web-push's setVapidDetails validates key length) + a telegram token
// so ChannelState.configured is observable as true.
process.env.VAPID_PUBLIC_KEY = "BFWiwwb5DfLL_MysabPmu20nSz5q9FyiF50ojDhtf5tmLXmcwCX0da48WAAZDKF868kRHg6hNcRUHQIHyMb5maI";
process.env.VAPID_PRIVATE_KEY = "2bVFR1q4Om90wgUkI0Jmi5lfHPF_1WSM4qkpKuzJo50";
process.env.VAPID_SUBJECT = "mailto:x@x";
process.env.TELEGRAM_BOT_TOKEN = "t";

const { getDb } = await import("@/lib/db");
const { getPrefsMatrix, setPref, getChannelState, putChannelState, mintTelegramNonce, clearTelegram, NotifInputError } =
  await import("@/lib/repo/notifications");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let uid = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; DELETE FROM notification_prefs; DELETE FROM notification_channels; DELETE FROM push_subscriptions; PRAGMA foreign_keys=ON;"
  );
  // users has no `name` column; username/password_hash/display_name/role/active/created_at/organization_id are what we seed.
  uid = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES (?, 'x:y', 'ک', 'salesperson', 1, ?, 1)"
      )
      .run(`u${Date.now()}${Math.random().toString(36).slice(2)}`, new Date().toISOString()).lastInsertRowid
  );
});

function prefCount(): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM notification_prefs").get() as { c: number }).c;
}
function channelRowCount(): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM notification_channels").get() as { c: number }).c;
}

describe("getPrefsMatrix", () => {
  it("has one deduped row per active catalogue type, defaults when no pref, no system.test", () => {
    const m = getPrefsMatrix(uid, 1);
    const codes = m.types.map((t) => t.code);
    const expected = (
      getDb()
        .prepare(
          "SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL AND active = 1 AND code <> 'system.test'"
        )
        .get() as { c: number }
    ).c;
    expect(codes.length).toBe(expected);
    expect(new Set(codes).size).toBe(codes.length); // deduped by code
    expect(codes).not.toContain("system.test");

    const esc = m.types.find((t) => t.code === "task.escalated")!;
    expect(esc.default_push).toBe(1);
    expect(esc.push).toBe(true); // no pref -> stored default
    expect(esc.telegram).toBe(true);
    const oc = m.types.find((t) => t.code === "order.created")!;
    expect(oc.default_push).toBe(0);
    expect(oc.push).toBe(false);
    expect(oc.telegram).toBe(false);
  });

  it("a pref row flips the effective value both ways, connection ignored", () => {
    setPref(uid, "order.created", "push", true); // default 0 -> on
    setPref(uid, "task.escalated", "telegram", false); // default 1 -> off
    const m = getPrefsMatrix(uid, 1);
    expect(m.types.find((t) => t.code === "order.created")!.push).toBe(true);
    expect(m.types.find((t) => t.code === "task.escalated")!.telegram).toBe(false);
    // default columns are unchanged by a pref
    expect(m.types.find((t) => t.code === "order.created")!.default_push).toBe(0);
  });

  it("returns a channels map with a push + telegram ChannelState", () => {
    const m = getPrefsMatrix(uid, 1);
    expect(Object.keys(m.channels).sort()).toEqual(["push", "telegram"]);
    expect(m.channels.push.enabled).toBe(true);
    expect(m.channels.push.connected).toBe(false);
    expect(m.channels.telegram.configured).toBe(true); // TELEGRAM_BOT_TOKEN is set
  });
});

describe("setPref", () => {
  it("a value equal to the stored default deletes any pref row", () => {
    setPref(uid, "order.created", "push", true); // non-default -> 1 row
    expect(prefCount()).toBe(1);
    setPref(uid, "order.created", "push", false); // back to default 0 -> delete
    expect(prefCount()).toBe(0);
  });

  it("a non-default value upserts exactly one row (idempotent)", () => {
    setPref(uid, "task.escalated", "push", false);
    setPref(uid, "task.escalated", "push", false);
    expect(prefCount()).toBe(1);
    const row = getDb()
      .prepare("SELECT enabled FROM notification_prefs WHERE user_id = ? AND type_code = 'task.escalated' AND channel = 'push'")
      .get(uid) as { enabled: number };
    expect(row.enabled).toBe(0);
  });

  it("throws NotifInputError on an unknown type code or a bad channel", () => {
    expect(() => setPref(uid, "nope.nope", "push", true)).toThrow(NotifInputError);
    // @ts-expect-error deliberately bad channel
    expect(() => setPref(uid, "task.escalated", "email", true)).toThrow(NotifInputError);
  });
});

describe("getChannelState", () => {
  it("returns the spec defaults with no row and does not lazily insert", () => {
    const s = getChannelState(uid, "push");
    expect(s).toMatchObject({
      enabled: true,
      quiet_start: null,
      quiet_end: null,
      critical_breaks_quiet: true,
    });
    expect(channelRowCount()).toBe(0); // read never writes
  });

  it("reports connected once a push subscription / telegram chat id exists", () => {
    expect(getChannelState(uid, "push").connected).toBe(false);
    getDb()
      .prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES (?,?,?,?,?)")
      .run(`e${Math.random()}`, "p", "a", new Date().toISOString(), uid);
    expect(getChannelState(uid, "push").connected).toBe(true);

    expect(getChannelState(uid, "telegram").connected).toBe(false);
    getDb().prepare("UPDATE users SET telegram_chat_id = '55' WHERE id = ?").run(uid);
    expect(getChannelState(uid, "telegram").connected).toBe(true);
  });
});

describe("putChannelState", () => {
  it("rejects a malformed HH:MM, accepts a zero-padded one, and null clears a bound", () => {
    expect(() => putChannelState(uid, "push", { quiet_start: "9:5" })).toThrow(NotifInputError);
    expect(() => putChannelState(uid, "push", { quiet_start: "24:00" })).toThrow(NotifInputError);
    putChannelState(uid, "push", { quiet_start: "09:05" });
    expect(getChannelState(uid, "push").quiet_start).toBe("09:05");
    putChannelState(uid, "push", { quiet_start: null });
    expect(getChannelState(uid, "push").quiet_start).toBe(null);
  });

  it("first write fills the unset keys with 21:00 / 08:00; a later write patches only supplied keys", () => {
    putChannelState(uid, "push", { enabled: false });
    const row = getDb()
      .prepare(
        "SELECT enabled, quiet_start, quiet_end, critical_breaks_quiet FROM notification_channels WHERE user_id = ? AND channel = 'push'"
      )
      .get(uid) as { enabled: number; quiet_start: string; quiet_end: string; critical_breaks_quiet: number };
    expect(row).toEqual({ enabled: 0, quiet_start: "21:00", quiet_end: "08:00", critical_breaks_quiet: 1 });

    putChannelState(uid, "push", { quiet_start: "07:00", critical_breaks_quiet: false });
    const s = getChannelState(uid, "push");
    expect(s.enabled).toBe(false); // untouched by the second call
    expect(s.quiet_start).toBe("07:00");
    expect(s.quiet_end).toBe("08:00"); // untouched
    expect(s.critical_breaks_quiet).toBe(false);
  });
});

describe("telegram link", () => {
  it("mintTelegramNonce writes a fresh base64url nonce each call; clearTelegram nulls both columns", () => {
    const a = mintTelegramNonce(uid);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(0);
    expect((getDb().prepare("SELECT telegram_link_nonce n FROM users WHERE id = ?").get(uid) as { n: string }).n).toBe(a);

    const b = mintTelegramNonce(uid);
    expect(b).not.toBe(a);
    expect((getDb().prepare("SELECT telegram_link_nonce n FROM users WHERE id = ?").get(uid) as { n: string }).n).toBe(b);

    getDb().prepare("UPDATE users SET telegram_chat_id = '9' WHERE id = ?").run(uid);
    clearTelegram(uid);
    const row = getDb()
      .prepare("SELECT telegram_chat_id, telegram_link_nonce FROM users WHERE id = ?")
      .get(uid) as { telegram_chat_id: string | null; telegram_link_nonce: string | null };
    expect(row.telegram_chat_id).toBe(null);
    expect(row.telegram_link_nonce).toBe(null);
  });
});
