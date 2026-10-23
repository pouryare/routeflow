import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-signout-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME, parseSessionToken } = await import("@/lib/auth");
const { getSessionFromCookies } = await import("@/lib/session");
const { POST } = await import("@/app/api/me/sign-out/route");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function mkUser(username: string): Promise<number> {
  return Number(
    (await getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, token_version, created_at)
         VALUES (?, 'x', ?, 'owner', 1, 1, 0, '2026-01-01')`
      )
      .run(username, username)).lastInsertRowid
  );
}

const token = (uid: number, extra: Record<string, unknown> = {}) =>
  createSessionToken({ uid, role: "owner", gid: null, oid: 1, tv: 0, name: "t", ...extra } as never);

const req = (cookie: string, scope: string) => {
  const body = new URLSearchParams({ scope });
  return new NextRequest("http://localhost/api/me/sign-out", {
    method: "POST",
    headers: { cookie: `${COOKIE_NAME}=${cookie}`, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
};

const cookieOf = (res: Response) => {
  const raw = res.headers.get("set-cookie") ?? "";
  return decodeURIComponent(raw.split(";")[0].split("=").slice(1).join("="));
};

describe("sign out everywhere", () => {
  it("ends every other session and keeps this device signed in", async () => {
    const id = await mkUser("s1");
    const other = token(id);
    const res = await POST(req(token(id), "others"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/settings/security?done=others");
    expect(await getSessionFromCookies(other)).toBeNull();
    const fresh = cookieOf(res);
    expect(parseSessionToken(fresh)?.tv).toBe(1);
    expect((await getSessionFromCookies(fresh))?.user.id).toBe(id);
  });

  it("with scope=all, ends this device too", async () => {
    const id = await mkUser("s2");
    const res = await POST(req(token(id), "all"));
    expect(res.headers.get("location")).toContain("/login");
    expect(cookieOf(res)).toBe("");
    expect(await getSessionFromCookies(token(id))).toBeNull();
  });

  it("refuses under Login-As and changes nothing", async () => {
    const target = await mkUser("s3");
    const actor = await mkUser("s4");
    const res = await POST(req(token(target, { act: actor }), "others"));
    expect(res.headers.get("location")).toContain("error=impersonating");
    const { token_version } = await getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(target) as { token_version: number };
    expect(token_version).toBe(0);
  });
});
