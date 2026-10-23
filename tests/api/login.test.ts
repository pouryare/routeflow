import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { vi } from "vitest";

const testDbPath = path.join(os.tmpdir(), `coverage-test-login-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { POST } = await import("@/app/api/login/route");
const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { hashPassword, parseSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// There is only one way in now, so the rate-limit cases run through a real account
// rather than the shared password they used to use.
beforeAll(async () => {
  const db = getDb();
  await db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, 'owner', NULL, 1, ?)"
  ).run("limiter", hashPassword("hunter2-real"), "محدودیت", new Date().toISOString());
});

function loginReq(password: string, ip: string) {
  return new NextRequest("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "limiter", password }),
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  });
}

describe("POST /api/login", () => {
  it("accepts the correct password and sets a session cookie", async () => {
    const res = await POST(loginReq("hunter2-real", "9.9.9.1"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });

  it("pays the same password-hash cost for an unknown, a deactivated and a wrong-password login (no timing tell)", async () => {
    await getDb()
      .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES ('gone', ?, 'x', 'owner', NULL, 0, ?)")
      .run(hashPassword("gone-pass"), new Date().toISOString());
    const spy = vi.spyOn(crypto, "scryptSync");
    const attempt = async (username: string, password: unknown, ip: string) => {
      spy.mockClear();
      const res = await POST(
        new NextRequest("http://localhost/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
          headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        })
      );
      return { status: res.status, body: await res.json(), kdf: spy.mock.calls.length };
    };
    const unknown = await attempt("nobody-here", "whatever", "9.9.8.1");
    const deactivated = await attempt("gone", "gone-pass", "9.9.8.2");
    const wrong = await attempt("limiter", "wrong", "9.9.8.3");
    const noPassword = await attempt("nobody-here", undefined, "9.9.8.4");
    spy.mockRestore();
    for (const r of [unknown, deactivated, wrong, noPassword]) {
      expect(r.status).toBe(401);
      expect(r.kdf, "every refusal pays one scrypt").toBe(1);
    }
    expect(unknown.body).toEqual(wrong.body);
    expect(deactivated.body).toEqual(wrong.body);
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
    const ok = await POST(loginReq("hunter2-real", ip));
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
  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    gid = Number(
      (await db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
        .run("گروه تست", "test-group", "#0ff", now)).lastInsertRowid
    );
    await db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
    ).run("sara", hashPassword("sara-pass"), "سارا", "group_manager", gid, now);
    await db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
    ).run("ghost", hashPassword("ghost-pass"), "غایب", "delivery_driver", gid, now);
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

describe("the shared password is gone", () => {
  it("refuses a password-only request, whatever the password", async () => {
    // APP_PASSWORD used to open the app on its own. Nothing reads it any more, so a body
    // with no username cannot authenticate regardless of what it carries.
    for (const password of ["hunter2", "hunter2-real", "sara-pass"]) {
      const res = await POST(
        new NextRequest("http://localhost/api/login", {
          method: "POST",
          body: JSON.stringify({ password }),
          headers: { "Content-Type": "application/json", "x-forwarded-for": "7.7.7." + password.length },
        })
      );
      expect(res.status).toBe(401);
    }
  });

  it("no longer reports a shared_password_login flag", async () => {
    const res = await POST(namedLogin("sara", "sara-pass", "8.8.9.9"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect("shared_password_login" in data).toBe(false);
  });
});
