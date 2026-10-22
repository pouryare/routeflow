import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* The two server-side redirect loops (single link: /api/geo/decode-link; bulk paste import:
 * resolveMapsLink) must refuse any hop that leaves the map services or points inside, and must
 * make NO request to the refused target. fetchNoRedirect is the only thing that touches the
 * network here, so mocking it records exactly which URLs would have been requested. */

const testDbPath = path.join(os.tmpdir(), `rf-ssrf-hops-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const requested: string[] = [];
let chain: Record<string, { status: number; location?: string }> = {};

vi.mock("@/lib/fetchNoRedirect", () => ({
  FETCH_TIMEOUT_MS: 1000,
  fetchNoRedirect: vi.fn(async (url: string) => {
    requested.push(url);
    const step = chain[url] ?? { status: 200 };
    return new Response(null, { status: step.status, headers: step.location ? { location: step.location } : {} });
  }),
}));
vi.mock("@/lib/playwrightExtract", () => ({
  extractViaBrowser: vi.fn(async () => null),
  browserLifecycle: { getBrowser: vi.fn(), closeBrowser: vi.fn(async () => {}) },
}));

const { resolveMapsLink } = await import("@/lib/resolveMapsLink");
const { GET } = await import("@/app/api/geo/decode-link/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { getDb } = await import("@/lib/db");

const START = "https://maps.app.goo.gl/abc";
const BAD_TARGETS = [
  "http://127.0.0.1:3003/api/me",
  "http://169.254.169.254/latest/meta-data/",
  "http://[::ffff:7f00:1]/",
  "http://metadata.internal/",
  "https://evil.example.com/steal",
  "https://google.com.evil.example.com/",
];

beforeEach(() => {
  requested.length = 0;
  chain = {};
});

describe("resolveMapsLink (bulk import)", () => {
  it.each(BAD_TARGETS)("never requests a redirect target outside the map services: %s", async (target) => {
    chain = { [START]: { status: 302, location: target } };
    const out = await resolveMapsLink(START);
    expect(out.resolution).toBe("unresolved");
    expect(requested).toEqual([START]);
  });

  it("refuses a LATER hop too, not just the first", async () => {
    chain = {
      [START]: { status: 302, location: "https://www.google.com/hop2" },
      "https://www.google.com/hop2": { status: 302, location: "http://127.0.0.1/admin" },
    };
    const out = await resolveMapsLink(START);
    expect(out.resolution).toBe("unresolved");
    expect(requested).toEqual([START, "https://www.google.com/hop2"]);
  });

  it("still follows allowed hops to a link that carries coordinates", async () => {
    chain = { [START]: { status: 302, location: "https://www.google.com/maps/place/x/@35.7,51.4,17z" } };
    const out = await resolveMapsLink(START);
    expect(out).toMatchObject({ resolution: "direct", lat: 35.7, lng: 51.4 });
  });

  it("does not even start from a host off the allow-list", async () => {
    const out = await resolveMapsLink("http://127.0.0.1:3003/");
    expect(out.resolution).toBe("unresolved");
    expect(requested).toEqual([]);
  });
});

describe("GET /api/geo/decode-link (single link)", () => {
  let cookie = "";
  const call = (url: string) =>
    GET(new NextRequest(`http://localhost/api/geo/decode-link?url=${encodeURIComponent(url)}`, { headers: { cookie } }));

  beforeEach(() => {
    if (cookie) return;
    const db = getDb();
    const id = Number(
      db
        .prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES ('dl', 'x:y', 'x', 'owner', 1, '2026-01-01', 1)")
        .run().lastInsertRowid
    );
    cookie = `${COOKIE_NAME}=${createSessionToken({ uid: id, role: "owner", gid: null, oid: 1, tv: 0, name: "x" })}`;
  });

  it.each(BAD_TARGETS)("answers 400 and never requests the target: %s", async (target) => {
    chain = { [START]: { status: 302, location: target } };
    const res = await call(START);
    expect(res.status).toBe(400);
    expect(requested).toEqual([START]);
  });

  it("refuses a later hop", async () => {
    chain = {
      [START]: { status: 301, location: "https://www.google.com/hop2" },
      "https://www.google.com/hop2": { status: 301, location: "http://10.0.0.5/" },
    };
    expect((await call(START)).status).toBe(400);
    expect(requested).toEqual([START, "https://www.google.com/hop2"]);
  });

  it("follows allowed hops to coordinates", async () => {
    chain = { [START]: { status: 302, location: "https://www.google.com/maps/place/x/@35.7,51.4,17z" } };
    const res = await call(START);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, lat: 35.7, lng: 51.4 });
  });

  it("rejects a starting host off the allow-list", async () => {
    expect((await call("http://127.0.0.1:3003/")).status).toBe(400);
    expect(requested).toEqual([]);
  });
});
