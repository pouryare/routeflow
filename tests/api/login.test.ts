import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-login-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "hunter2";

const { POST } = await import("@/app/api/login/route");
const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { hashPassword, parseSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

function loginReq(password: string, ip: string) {
  return new NextRequest("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify({ password }),
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  });
}

describe("POST /api/login", () => {
  it("accepts the correct password and sets a session cookie", async () => {
    const res = await POST(loginReq("hunter2", "9.9.9.1"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });

  it("rejects a wrong password", async () => {
    const res = await POST(loginReq("wrong", "9.9.9.2"));
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed attempts from the same IP", async () => {
    const ip = "9.9.9.3";
    for (let i = 0; i < 5; i++) {
      await POST(loginReq("wrong", ip));
    }
    const res = await POST(loginReq("wrong", ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not rate-limit a different IP", async () => {
    const res = await POST(loginReq("wrong", "9.9.9.4"));
    expect(res.status).toBe(401);
  });

  it("a successful login resets the attempt counter for that IP", async () => {
    const ip = "9.9.9.5";
    for (let i = 0; i < 4; i++) {
      await POST(loginReq("wrong", ip));
    }
    const ok = await POST(loginReq("hunter2", ip));
    expect(ok.status).toBe(200);
    // would have been the 6th attempt (blocked) had the counter not reset
    const after = await POST(loginReq("wrong", ip));
    expect(after.status).toBe(401);
  });
});

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0].split("=").slice(1).join("=");
}

function namedLogin(username: string, password: string, ip: string) {
  return new NextRequest("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  });
}

describe("named account login", () => {
  let gid = 0;
  beforeAll(() => {
    const db = getDb();
    const now = new Date().toISOString();
    gid = Number(
      db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
        .run("گروه تست", "test-group", "#0ff", now).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
    ).run("sara", hashPassword("sara-pass"), "سارا", "group_manager", gid, now);
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
    ).run("ghost", hashPassword("ghost-pass"), "غایب", "driver", gid, now);
  });

  it("mints a token carrying the account's role and group", async () => {
    const res = await POST(namedLogin("sara", "sara-pass", "8.8.1.1"));
    expect((await res.json()).ok).toBe(true);
    const claims = parseSessionToken(cookieFrom(res));
    expect(claims?.role).toBe("group_manager");
    expect(claims?.gid).toBe(gid);
    expect(claims?.name).toBe("سارا");
  });

  it("names the v2 cookie", async () => {
    const res = await POST(namedLogin("sara", "sara-pass", "8.8.1.2"));
    expect(res.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });

  it("rejects a wrong password for a real account", async () => {
    const res = await POST(namedLogin("sara", "nope", "8.8.1.3"));
    expect(res.status).toBe(401);
  });

  it("refuses a deactivated account even with the right password", async () => {
    const res = await POST(namedLogin("ghost", "ghost-pass", "8.8.1.4"));
    expect(res.status).toBe(401);
  });

  it("gives the same error for an unknown user as for a bad password", async () => {
    const unknown = await POST(namedLogin("nobody", "whatever", "8.8.1.5"));
    const wrongPw = await POST(namedLogin("sara", "wrong", "8.8.1.6"));
    expect(unknown.status).toBe(wrongPw.status);
    expect((await unknown.json()).error).toBe((await wrongPw.json()).error);
  });
});

describe("shared password migration login", () => {
  it("still works, but only as an owner, and says so", async () => {
    const res = await POST(loginReq("hunter2", "8.8.2.1"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.shared_password_login).toBe(true);
    const claims = parseSessionToken(cookieFrom(res));
    expect(claims?.role).toBe("owner");
    expect(claims?.gid).toBeNull();
    expect(claims?.uid).toBe(0);
  });
});
