import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest, NextResponse } from "next/server";

const testDbPath = path.join(os.tmpdir(), `rf-idem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

let userId = 0;
vi.mock("@/lib/session", () => ({ getSession: async () => ({ organizationId: 1, user: { id: userId } }) }));

const { getDb } = await import("@/lib/db");
const { once } = await import("@/lib/repo/idempotency");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const req = (key?: string) =>
  new NextRequest("http://x/api/payments", { method: "POST", headers: key ? { "idempotency-key": key } : {} });

describe("Z2 one-time key", () => {
  it("runs once for a repeated key and gives the first answer back", async () => {
    userId = Number(
      (await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('idem','x','i','owner',1,'2026-01-01T00:00:00.000Z',1)").run()).lastInsertRowid
    );
    let runs = 0;
    const run = async () => NextResponse.json({ ok: true, id: ++runs });
    const a = await once(req("key-aaaaaaaa"), run);
    const b = await once(req("key-aaaaaaaa"), run);
    expect(runs).toBe(1);
    expect(await a.json()).toEqual({ ok: true, id: 1 });
    expect(await b.json()).toEqual({ ok: true, id: 1 });
    expect(b.headers.get("idempotent-replay")).toBe("1");
  });

  it("lets a failed first try be sent again, and does not guard a request with no key", async () => {
    let runs = 0;
    const bad = async () => (++runs, NextResponse.json({ ok: false }, { status: 400 }));
    await once(req("key-bbbbbbbb"), bad);
    await once(req("key-bbbbbbbb"), bad);
    expect(runs).toBe(2);
    const ok = async () => (++runs, NextResponse.json({ ok: true }));
    await once(req(), ok);
    await once(req(), ok);
    expect(runs).toBe(4);
  });

  it("answers 409 to a repeat that arrives while the first is still running", async () => {
    let release!: () => void;
    const slow = () => new Promise<NextResponse>((r) => (release = () => r(NextResponse.json({ ok: true }))));
    const first = once(req("key-cccccccc"), slow);
    await new Promise((r) => setTimeout(r, 50));
    const second = await once(req("key-cccccccc"), async () => NextResponse.json({ ok: true }));
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });
});
