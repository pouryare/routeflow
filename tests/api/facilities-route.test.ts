import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-facr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/facilities/route");
const { PATCH, DELETE } = await import("@/app/api/facilities/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// These routes require a real session now. This file covers site mechanics, not
// authorisation, so everything runs as an owner -- scoping lives in scoping.test.ts.
let ownerId = 0;

beforeAll(() => {
  const db = getDb();
  ownerId = Number(
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, ?, ?, 'owner', NULL, 1, ?, 1)"
    ).run("fac-owner", "x:y", "مالک", new Date().toISOString()).lastInsertRowid
  );
});

function authCookie() {
  const token = createSessionToken({ uid: ownerId, role: "owner", gid: null, oid: 1, tv: 0, name: "مالک" });
  return `${COOKIE_NAME}=${token}`;
}

function facReq(body: unknown) {
  return new NextRequest("http://localhost/api/facilities", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: authCookie() },
  });
}

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/facilities/1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: authCookie() },
  });
}

function delReq() {
  return new NextRequest("http://localhost/api/facilities/1", { method: "DELETE", headers: { cookie: authCookie() } });
}

function ctx(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

function seedExtraFacility(): number {
  const now = new Date().toISOString();
  const r = getDb()
    .prepare(
      `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at, organization_id)
       VALUES (?, 'other', 'موقت', 35.7, 51.4, 0, ?, ?, 1)`
    )
    .run(`tmp-${Math.random().toString(36).slice(2)}`, now, now);
  return Number(r.lastInsertRowid);
}

describe("POST /api/facilities", () => {
  it("creates a site and generates a unique slug", async () => {
    const res = await POST(facReq({ name: "انبار دوم", kind: "warehouse", lat: 35.7, lng: 51.4 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const row = getDb()
      .prepare("SELECT slug, kind, is_default_origin FROM facilities WHERE id = ?")
      .get(body.id) as unknown as { slug: string; kind: string; is_default_origin: number };
    expect(row.kind).toBe("warehouse");
    expect(row.slug).toMatch(/^site-/);
    // A new site never steals the origin; that is an explicit choice the user makes.
    expect(row.is_default_origin).toBe(0);
  });

  it("rejects coordinates outside the valid range", async () => {
    expect((await POST(facReq({ name: "بد", kind: "other", lat: 999, lng: 51.4 }))).status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    expect((await POST(facReq({ name: "بد", kind: "spaceport", lat: 35.7, lng: 51.4 }))).status).toBe(400);
  });

  it("rejects a blank name", async () => {
    expect((await POST(facReq({ name: "   ", kind: "other", lat: 35.7, lng: 51.4 }))).status).toBe(400);
  });
});

describe("GET /api/facilities", () => {
  it("returns every site", async () => {
    const res = await GET(new NextRequest("http://localhost/api/facilities", { headers: { cookie: authCookie() } }));
    const body = await res.json();
    // >= 2 because this file creates its own fixtures; nothing is seeded.
    expect(body.facilities.length).toBeGreaterThanOrEqual(2);
  });

  // A pin move must invalidate the cache signature, or the client keeps rendering the
  // old position behind a 304 -- the exact bug updated_at exists to prevent.
  it("answers 304 while nothing changes, then 200 once a pin moves", async () => {
    const first = await GET(new NextRequest("http://localhost/api/facilities", { headers: { cookie: authCookie() } }));
    const tag = first.headers.get("ETag")!;

    const second = await GET(
      new NextRequest("http://localhost/api/facilities", { headers: { "if-none-match": tag, cookie: authCookie() } })
    );
    expect(second.status).toBe(304);

    const id = seedExtraFacility();
    await PATCH(patchReq({ lat: 35.72, lng: 51.42 }), ctx(id));

    const third = await GET(
      new NextRequest("http://localhost/api/facilities", { headers: { "if-none-match": tag, cookie: authCookie() } })
    );
    expect(third.status).toBe(200);
  });
});

describe("PATCH /api/facilities/[id]", () => {
  it("moves a pin and stamps updated_at", async () => {
    const id = seedExtraFacility();
    const before = (
      getDb().prepare("SELECT updated_at FROM facilities WHERE id = ?").get(id) as unknown as { updated_at: string }
    ).updated_at;
    await new Promise((r) => setTimeout(r, 5));

    expect((await PATCH(patchReq({ lat: 35.71, lng: 51.41 }), ctx(id))).status).toBe(200);

    const row = getDb()
      .prepare("SELECT lat, updated_at FROM facilities WHERE id = ?")
      .get(id) as unknown as { lat: number; updated_at: string };
    expect(row.lat).toBeCloseTo(35.71, 5);
    expect(row.updated_at).not.toBe(before);
  });

  it("renames a site", async () => {
    const id = seedExtraFacility();
    await PATCH(patchReq({ name: "انبار شمال" }), ctx(id));
    const row = getDb().prepare("SELECT name FROM facilities WHERE id = ?").get(id) as unknown as { name: string };
    expect(row.name).toBe("انبار شمال");
  });

  it("keeps exactly one default origin when the flag moves", async () => {
    const id = seedExtraFacility();
    await PATCH(patchReq({ is_default_origin: true }), ctx(id));
    const flagged = getDb()
      .prepare("SELECT id FROM facilities WHERE is_default_origin = 1")
      .all() as unknown as { id: number }[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe(id);
    // Put it back so later tests start from the state they expect. It used to restore the
    // seeded home base by slug; nothing is seeded now, so it flags the next warehouse.
    const other = getDb()
      .prepare("SELECT id FROM facilities WHERE kind = 'warehouse' AND id != ? ORDER BY id LIMIT 1")
      .get(id) as unknown as { id: number } | undefined;
    if (other) await PATCH(patchReq({ is_default_origin: true }), ctx(other.id));
  });

  // Clearing the flag directly would leave the app with no origin at all. The flag
  // moves by being set somewhere else, never by being unset.
  it("refuses to clear the default origin flag directly", async () => {
    const current = getDb()
      .prepare("SELECT id FROM facilities WHERE is_default_origin = 1")
      .get() as unknown as { id: number };
    expect((await PATCH(patchReq({ is_default_origin: false }), ctx(current.id))).status).toBe(400);
  });

  it("rejects invalid coordinates", async () => {
    const id = seedExtraFacility();
    expect((await PATCH(patchReq({ lat: 91, lng: 0 }), ctx(id))).status).toBe(400);
  });

  it("rejects an empty rename", async () => {
    const id = seedExtraFacility();
    expect((await PATCH(patchReq({ name: "  " }), ctx(id))).status).toBe(400);
  });

  it("400s a non-numeric id and 404s an unknown one", async () => {
    expect((await PATCH(patchReq({ name: "x" }), ctx("abc"))).status).toBe(400);
    expect((await PATCH(patchReq({ name: "x" }), ctx(999999))).status).toBe(404);
  });
});

// Mutates shared state, so it runs after everything above -- vitest executes describe
// blocks in declaration order within a file.
describe("DELETE /api/facilities/[id]", () => {
  it("deletes a site", async () => {
    const id = seedExtraFacility();
    expect((await DELETE(delReq(), ctx(id))).status).toBe(200);
    expect(getDb().prepare("SELECT id FROM facilities WHERE id = ?").get(id)).toBeUndefined();
  });

  // Losing the origin entirely would strand every distance in the app.
  it("promotes another site when the default origin is deleted", async () => {
    seedExtraFacility();
    const victim = getDb()
      .prepare("SELECT id FROM facilities WHERE is_default_origin = 1")
      .get() as unknown as { id: number };
    await DELETE(delReq(), ctx(victim.id));
    const flagged = getDb()
      .prepare("SELECT id FROM facilities WHERE is_default_origin = 1")
      .all() as unknown as { id: number }[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).not.toBe(victim.id);
  });

  it("hands the deleted row back so the delete can be undone from the toast", async () => {
    const id = seedExtraFacility();
    const body = await (await DELETE(delReq(), ctx(id))).json();
    expect(body.deleted.id).toBe(id);
    expect(body.deleted.lat).toBeTypeOf("number");
    expect(body.deleted.slug).toBeTypeOf("string");
  });

  it("restores a deleted site under its original id and slug", async () => {
    // The id matters more than the pin: the arrival log and any facility stop on a plan
    // reference it, so an undo that invented a new id would put the marker back while
    // orphaning every visit recorded there.
    const id = seedExtraFacility();
    const { deleted } = await (await DELETE(delReq(), ctx(id))).json();

    const res = await POST(facReq({ ...deleted, restore: { id: deleted.id, slug: deleted.slug } }));
    const body = await res.json();
    expect(body.restored).toBe(true);
    expect(body.id).toBe(id);

    const back = getDb().prepare("SELECT slug FROM facilities WHERE id = ?").get(id) as unknown as { slug: string };
    expect(back.slug).toBe(deleted.slug);
  });

  it("falls back to a new id rather than overwriting whatever took the old one", async () => {
    const id = seedExtraFacility();
    const { deleted } = await (await DELETE(delReq(), ctx(id))).json();
    // Something else claims that id in the meantime.
    getDb()
      .prepare(
        `INSERT INTO facilities (id, slug, kind, name, lat, lng, is_default_origin, created_at, updated_at, organization_id)
         VALUES (?, 'squatter', 'other', 'جای گرفته', 35.7, 51.4, 0, ?, ?, 1)`
      )
      .run(id, new Date().toISOString(), new Date().toISOString());

    const body = await (await POST(facReq({ ...deleted, restore: { id: deleted.id, slug: deleted.slug } }))).json();
    expect(body.restored).toBe(false);
    expect(body.id).not.toBe(id);
    const squatter = getDb().prepare("SELECT name FROM facilities WHERE id = ?").get(id) as unknown as { name: string };
    expect(squatter.name).toBe("جای گرفته");
  });

  it("refuses to delete the last remaining site", async () => {
    const db = getDb();
    db.prepare("DELETE FROM facilities WHERE id NOT IN (SELECT MIN(id) FROM facilities)").run();
    const last = db.prepare("SELECT id FROM facilities").get() as unknown as { id: number };
    expect((await DELETE(delReq(), ctx(last.id))).status).toBe(400);
  });
});
