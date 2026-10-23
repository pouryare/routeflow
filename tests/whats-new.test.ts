import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-whatsnew-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { notesFor, unseenFor } = await import("@/lib/whatsNew");
const { WHATS_NEW } = await import("@/lib/whatsNew/notes");
const { getPrefs, setPrefs } = await import("@/lib/repo/prefs");
const { default: WhatsNewCard } = await import("@/components/today/WhatsNewCard");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const entries = [
  { version: "2026-11-01", items: [{ text: "برای راننده", roles: ["delivery_driver" as const] }, { text: "برای همه" }] },
  { version: "2026-10-23", items: [{ text: "قدیمی برای فروشنده", roles: ["phone_sales" as const] }] },
];

describe("what's new (F112)", () => {
  it("the notes file is newest first, dated, and has no empty entry", () => {
    const versions = WHATS_NEW.map((e) => e.version);
    expect([...versions].sort().reverse()).toEqual(versions);
    for (const e of WHATS_NEW) {
      expect(e.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.items.length).toBeGreaterThan(0);
    }
  });

  it("drops lines meant for other roles", () => {
    expect(notesFor("phone_sales", entries).map((e) => e.items.map((i) => i.text))).toEqual([["برای همه"], ["قدیمی برای فروشنده"]]);
  });

  it("shows only the latest to a new account, everything after the seen version otherwise, and nothing once seen", () => {
    expect(unseenFor("phone_sales", undefined, entries)?.items.map((i) => i.text)).toEqual(["برای همه"]);
    expect(unseenFor("phone_sales", "2026-10-01", entries)).toEqual({ version: "2026-11-01", items: [{ text: "برای همه" }, { text: "قدیمی برای فروشنده", roles: ["phone_sales"] }] });
    expect(unseenFor("phone_sales", "2026-11-01", entries)).toBeNull();
  });

  it("remembers the dismissed version in the person's preferences, and only a real version", () => {
    const db = getDb();
    const id = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('s','x','س','phone_sales',1,?,1)").run(new Date().toISOString()).lastInsertRowid);
    setPrefs(id, { whats_new_seen: WHATS_NEW[0].version });
    expect(getPrefs(id).whats_new_seen).toBe(WHATS_NEW[0].version);
    expect(unseenFor("phone_sales", getPrefs(id).whats_new_seen)).toBeNull();
    expect(() => setPrefs(id, { whats_new_seen: "1999-01-01" })).toThrow();
  });

  it("the card lists the lines with a dismiss button and a link to the history", () => {
    const html = renderToStaticMarkup(createElement(WhatsNewCard, { entry: entries[0] }));
    expect(html).toContain("تازه‌های برنامه");
    expect(html).toContain("برای همه");
    expect(html).toContain("دیدم");
    expect(html).toContain("/settings/updates");
  });
});
