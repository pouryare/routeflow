import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-login-events-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { hashPassword } = await import("@/lib/auth");
const { recordLogin, recentLogins, myRecentLogins, lastSignInByUser } = await import("@/lib/repo/loginEvents");
const { POST } = await import("@/app/api/login/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function mkUser(username: string, active = 1): Promise<number> {
  return Number(
    (await getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, created_at)
         VALUES (?, ?, ?, 'owner', 1, ?, '2026-01-01')`
      )
      .run(username, hashPassword("right-pass"), username, active)).lastInsertRowid
  );
}

const login = (username: string, password: string, ip: string) =>
  POST(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/129.0" },
    })
  );

describe("sign-in log", () => {
  it("records a success and a wrong password on a real account, and nothing for an unknown name", async () => {
    const id = await mkUser("le1");
    await login("le1", "wrong", "10.0.0.1");
    await login("le1", "right-pass", "10.0.0.1");
    await login("nobody-here", "whatever", "10.0.0.1");
    const mine = await myRecentLogins(1, id);
    expect(mine.map((r) => r.result)).toEqual(["success", "bad_password"]);
    expect(mine[0].ip).toBe("10.0.0.1");
    expect((await recentLogins(1)).every((r) => r.display_name !== "nobody-here")).toBe(true);
    expect((await lastSignInByUser(1)).get(id)).toBe(mine[0].created_at);
  });

  it("records a deactivated account's attempt", async () => {
    const id = await mkUser("le2", 0);
    await login("le2", "right-pass", "10.0.0.2");
    expect((await myRecentLogins(1, id))[0].result).toBe("inactive");
  });

  it("drops rows older than 90 days on the next write", async () => {
    const id = await mkUser("le3");
    await recordLogin({ organizationId: 1, userId: id, result: "success", ip: null, userAgent: null, now: new Date("2026-01-01T00:00:00Z") });
    await recordLogin({ organizationId: 1, userId: id, result: "success", ip: null, userAgent: null, now: new Date("2026-06-01T00:00:00Z") });
    expect(await myRecentLogins(1, id)).toHaveLength(1);
  });
});
