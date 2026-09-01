import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-lists-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, readLeadLists } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/lead-lists/route");
const { PATCH, DELETE } = await import("@/app/api/lead-lists/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// These routes require a real session now. This file is about list mechanics, not
// authorisation, so everything here runs as an owner; the scoping rules themselves live
// in tests/api/scoping.test.ts.
let ownerId = 0;

function authCookie() {
  const token = createSessionToken({ uid: ownerId, role: "owner", gid: null, tv: 0, name: "مالک" });
  return `${COOKIE_NAME}=${token}`;
}

let locA = 0;
let locB = 0;
let locC = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  ownerId = Number(
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, 'owner', NULL, 1, ?)"
    ).run("lists-owner", "x:y", "مالک", now).lastInsertRowid
  );
  const insert = db.prepare(
    "INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, created_at) VALUES (?, ?, ?, ?, 'manual', ?)"
  );
  locA = Number(insert.run("رستوران الف", "https://maps.example/a", 35.7, 51.4, now).lastInsertRowid);
  locB = Number(insert.run("رستوران ب", "https://maps.example/b", 35.71, 51.41, now).lastInsertRowid);
  locC = Number(insert.run("رستوران ج", "https://maps.example/c", 35.72, 51.42, now).lastInsertRowid);
});

function post(body: unknown) {
  return new NextRequest("http://localhost/api/lead-lists", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: authCookie() },
  });
}

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/lead-lists/1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: authCookie() },
  });
}

function ctx(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

describe("POST /api/lead-lists", () => {
  it("creates a named list with its membership in one request", async () => {
    const res = await POST(post({ name: "امشب", location_ids: [locB, locA] }));
    const body = await res.json();
    expect(body.ok).toBe(true);

    const list = readLeadLists().find((l) => l.id === body.id);
    // Order is the route, so it must come back exactly as sent -- not sorted.
    expect(list?.location_ids).toEqual([locB, locA]);
  });

  it("requires a name", async () => {
    expect((await POST(post({ name: "   " }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
  });

  it("rejects a malformed membership rather than silently dropping entries", async () => {
    expect((await POST(post({ name: "x", location_ids: ["a"] }))).status).toBe(400);
    expect((await POST(post({ name: "x", location_ids: [0] }))).status).toBe(400);
  });

  it("accepts an empty list, which is a legitimate thing to want", async () => {
    const res = await POST(post({ name: "خالی", location_ids: [] }));
    expect(res.status).toBe(200);
  });

  it("drops a repeated location instead of driving there twice", async () => {
    const body = await (await POST(post({ name: "تکراری", location_ids: [locA, locA, locB] }))).json();
    const list = readLeadLists().find((l) => l.id === body.id);
    expect(list?.location_ids).toEqual([locA, locB]);
  });
});

describe("PATCH /api/lead-lists/[id]", () => {
  it("renames", async () => {
    const { id } = await (await POST(post({ name: "قدیمی" }))).json();
    expect((await PATCH(patch({ name: "تازه" }), ctx(id))).status).toBe(200);
    expect(readLeadLists().find((l) => l.id === id)?.name).toBe("تازه");
  });

  it("replaces the membership wholesale, preserving the new order", async () => {
    const { id } = await (await POST(post({ name: "مسیر", location_ids: [locA, locB] }))).json();
    await PATCH(patch({ location_ids: [locC, locA] }), ctx(id));
    expect(readLeadLists().find((l) => l.id === id)?.location_ids).toEqual([locC, locA]);
  });

  it("skips a location that has since been deleted rather than failing the whole reorder", async () => {
    // Otherwise one stale id in a re-sent list would roll back the reorder around it and
    // the user's drag would silently do nothing.
    const { id } = await (await POST(post({ name: "با شناسه مرده" }))).json();
    await PATCH(patch({ location_ids: [locA, 999999, locB] }), ctx(id));
    expect(readLeadLists().find((l) => l.id === id)?.location_ids).toEqual([locA, locB]);
  });

  it("refuses an empty name", async () => {
    const { id } = await (await POST(post({ name: "دارد" }))).json();
    expect((await PATCH(patch({ name: "  " }), ctx(id))).status).toBe(400);
  });

  it("404s an unknown list and 400s a bad id", async () => {
    expect((await PATCH(patch({ name: "x" }), ctx(999999))).status).toBe(404);
    expect((await PATCH(patch({ name: "x" }), ctx("abc"))).status).toBe(400);
  });
});

describe("GET /api/lead-lists", () => {
  it("returns lists with their ordered membership", async () => {
    const body = await (await GET(new NextRequest("http://localhost/api/lead-lists", { headers: { cookie: authCookie() } }))).json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.lists)).toBe(true);
    expect(body.lists.every((l: { location_ids: unknown }) => Array.isArray(l.location_ids))).toBe(true);
  });
});

describe("DELETE /api/lead-lists/[id]", () => {
  it("deletes the list and hands back enough to undo it", async () => {
    const { id } = await (await POST(post({ name: "رفتنی", location_ids: [locA, locC] }))).json();
    const body = await (await DELETE(new NextRequest("http://localhost/x", { method: "DELETE", headers: { cookie: authCookie() } }), ctx(id))).json();
    expect(body.deleted.name).toBe("رفتنی");
    expect(body.deleted.location_ids).toEqual([locA, locC]);
    expect(readLeadLists().find((l) => l.id === id)).toBeUndefined();
  });

  it("takes the membership with it, leaving no orphan rows", async () => {
    const { id } = await (await POST(post({ name: "کاسکید", location_ids: [locB] }))).json();
    await DELETE(new NextRequest("http://localhost/x", { method: "DELETE", headers: { cookie: authCookie() } }), ctx(id));
    const left = getDb().prepare("SELECT COUNT(*) n FROM lead_list_items WHERE list_id = ?").get(id) as unknown as {
      n: number;
    };
    expect(left.n).toBe(0);
  });

  it("leaves the locations themselves alone", async () => {
    const { id } = await (await POST(post({ name: "بی‌ضرر", location_ids: [locA] }))).json();
    await DELETE(new NextRequest("http://localhost/x", { method: "DELETE", headers: { cookie: authCookie() } }), ctx(id));
    expect(getDb().prepare("SELECT id FROM saved_locations WHERE id = ?").get(locA)).toBeTruthy();
  });

  it("404s an unknown list", async () => {
    const res = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE", headers: { cookie: authCookie() } }), ctx(999999));
    expect(res.status).toBe(404);
  });
});

describe("deleting a location", () => {
  it("removes it from every list that held it", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const doomed = Number(
      db
        .prepare(
          "INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, created_at) VALUES (?, ?, ?, ?, 'manual', ?)"
        )
        .run("رفتنی", "https://maps.example/doomed", 35.6, 51.3, now).lastInsertRowid
    );
    const { id } = await (await POST(post({ name: "شامل رفتنی", location_ids: [locA, doomed] }))).json();

    db.prepare("DELETE FROM saved_locations WHERE id = ?").run(doomed);

    // The cascade is what keeps a list from pointing at a location that no longer exists.
    expect(readLeadLists().find((l) => l.id === id)?.location_ids).toEqual([locA]);
  });
});
