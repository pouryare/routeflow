import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-avatar-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { PHOTOS_DIR } = await import("@/lib/photos");
const { POST, DELETE } = await import("@/app/api/users/[id]/avatar/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true });
});

let me = 0;
let other = 0;

function cookie(uid: number, role: string, oid = 1) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}
// A minimal valid 1x1 PNG -- real bytes, small enough to inline, real enough for sharp
// to decode without a fixture file.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM photos; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,?)"
  );
  me = Number(insert.run("me", "x", "من", "salesperson", now, 1).lastInsertRowid);
  other = Number(insert.run("other", "x", "دیگری", "salesperson", now, 1).lastInsertRowid);
});

function uploadReq(uid: number, targetId: number, file?: Buffer) {
  const fd = new FormData();
  if (file) fd.append("file", new File([new Uint8Array(file)], "a.png", { type: "image/png" }));
  return new NextRequest(`http://x/api/users/${targetId}/avatar`, {
    method: "POST",
    headers: { cookie: cookie(uid, "salesperson") },
    body: fd,
  });
}

describe("POST /api/users/[id]/avatar", () => {
  it("uploads your own avatar", async () => {
    const res = await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const row = getDb().prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?").get(me);
    expect(row).toBeTruthy();
  });

  it("rejects uploading to someone else's avatar", async () => {
    const res = await POST(uploadReq(me, other, PNG_1PX), ctxFor(other));
    expect(res.status).toBe(403);
    const row = getDb().prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?").get(other);
    expect(row).toBeFalsy();
  });

  it("rejects a non-image file", async () => {
    const res = await POST(uploadReq(me, me, Buffer.from("not an image")), ctxFor(me));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("replaces the previous avatar instead of accumulating rows", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const first = getDb().prepare("SELECT id FROM photos WHERE entity_type='user' AND entity_id=?").get(me) as { id: number };
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const rows = getDb().prepare("SELECT id FROM photos WHERE entity_type='user' AND entity_id=?").all(me) as { id: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(first.id);
  });
});

describe("DELETE /api/users/[id]/avatar", () => {
  it("removes your own avatar", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar`, {
      method: "DELETE",
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await DELETE(req, ctxFor(me));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT * FROM photos WHERE entity_type='user' AND entity_id=?").get(me);
    expect(row).toBeFalsy();
  });

  it("is a harmless no-op when there is nothing to delete", async () => {
    const req = new NextRequest(`http://x/api/users/${me}/avatar`, {
      method: "DELETE",
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await DELETE(req, ctxFor(me));
    expect(res.status).toBe(200);
  });

  it("rejects deleting someone else's avatar", async () => {
    const req = new NextRequest(`http://x/api/users/${other}/avatar`, {
      method: "DELETE",
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await DELETE(req, ctxFor(other));
    expect(res.status).toBe(403);
  });
});

const { GET } = await import("@/app/api/users/[id]/avatar/file/route");

describe("GET /api/users/[id]/avatar/file", () => {
  it("serves the uploaded avatar", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file`, {
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("serves avif when asked", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file?format=avif`, {
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.headers.get("Content-Type")).toBe("image/avif");
  });

  it("404s when the user has no avatar", async () => {
    const req = new NextRequest(`http://x/api/users/${other}/avatar/file`, {
      headers: { cookie: cookie(me, "salesperson") },
    });
    const res = await GET(req, ctxFor(other));
    expect(res.status).toBe(404);
  });

  it("a colleague in the same organization can view it", async () => {
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file`, {
      headers: { cookie: cookie(other, "salesperson") },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.status).toBe(200);
  });

  it("a different organization cannot view it", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(now);
    const otherOrgUser = Number(
      db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('crossorg','x','x','owner',1,?,2)"
        )
        .run(now).lastInsertRowid,
    );
    await POST(uploadReq(me, me, PNG_1PX), ctxFor(me));
    const req = new NextRequest(`http://x/api/users/${me}/avatar/file`, {
      headers: { cookie: cookie(otherOrgUser, "owner", 2) },
    });
    const res = await GET(req, ctxFor(me));
    expect(res.status).toBe(404);
  });
});
