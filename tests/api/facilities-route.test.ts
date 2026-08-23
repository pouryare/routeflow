import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-facr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/facilities/route");
const { PATCH, DELETE } = await import("@/app/api/facilities/[id]/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function facReq(body: unknown) {
  return new NextRequest("http://localhost/api/facilities", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/facilities/1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function delReq() {
  return new NextRequest("http://localhost/api/facilities/1", { method: "DELETE" });
}

function ctx(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

function seedExtraFacility(): number {
  const now = new Date().toISOString();
  const r = getDb()
    .prepare(
      `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
       VALUES (?, 'other', 'موقت', 35.7, 51.4, 0, ?, ?)`
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
    const res = await GET(new NextRequest("http://localhost/api/facilities"));
    const body = await res.json();
    expect(body.facilities.length).toBeGreaterThanOrEqual(2);
  });

  // A pin move must invalidate the cache signature, or the client keeps rendering the
  // old position behind a 304 -- the exact bug updated_at exists to prevent.
  it("answers 304 while nothing changes, then 200 once a pin moves", async () => {
    const first = await GET(new NextRequest("http://localhost/api/facilities"));
    const tag = first.headers.get("ETag")!;

    const second = await GET(
      new NextRequest("http://localhost/api/facilities", { headers: { "if-none-match": tag } })
    );
    expect(second.status).toBe(304);

    const id = seedExtraFacility();
    await PATCH(patchReq({ lat: 35.72, lng: 51.42 }), ctx(id));

    const third = await GET(
      new NextRequest("http://localhost/api/facilities", { headers: { "if-none-match": tag } })
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
    // Put it back so later tests start from the seeded state.
    const home = getDb().prepare("SELECT id FROM facilities WHERE slug = 'home-pardis'").get() as unknown as { id: number };
    await PATCH(patchReq({ is_default_origin: true }), ctx(home.id));
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

  it("refuses to delete the last remaining site", async () => {
    const db = getDb();
    db.prepare("DELETE FROM facilities WHERE id NOT IN (SELECT MIN(id) FROM facilities)").run();
    const last = db.prepare("SELECT id FROM facilities").get() as unknown as { id: number };
    expect((await DELETE(delReq(), ctx(last.id))).status).toBe(400);
  });
});
