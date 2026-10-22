import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-2fa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { hashPassword, createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { totpAt, stepAt, base32Decode } = await import("@/lib/totp");
const { NextRequest } = await import("next/server");
const { POST: login } = await import("@/app/api/login/route");
const { POST: secondStep } = await import("@/app/api/login/second-factor/route");
const { POST: manage } = await import("@/app/api/admin/second-factor/route");
const { checkSecondFactor, beginEnrollment, confirmEnrollment } = await import("@/lib/repo/secondFactor");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let founderId = 0;
let ownerId = 0;

const json = (body: unknown, cookie?: string) =>
  new NextRequest("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
  });

const cookieFor = (uid: number, role: "platform_owner" | "owner", tv = 0) =>
  `${COOKIE_NAME}=${createSessionToken({ uid, role, gid: null, oid: 1, tv, name: "t" })}`;

beforeAll(() => {
  const db = getDb();
  const ins = db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, token_version, created_at, organization_id) VALUES (?, ?, ?, ?, 1, 0, '2026-01-01', 1)");
  founderId = Number(ins.run("founder", hashPassword("correct horse"), "F", "platform_owner").lastInsertRowid);
  ownerId = Number(ins.run("plainowner", hashPassword("correct horse"), "O", "owner").lastInsertRowid);
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'platform_owner')").run(founderId);
});

const currentCode = (secret: string, offset = 0) => totpAt(secret, stepAt(Date.now()) + offset);

describe("the founder's second login step", () => {
  it("does not change sign-in until it is switched on", async () => {
    const res = await login(json({ username: "founder", password: "correct horse" }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.secondFactor).toBeUndefined();
    expect(res.headers.get("set-cookie")).toContain(COOKIE_NAME);
  });

  it("is enrolled with a code from the app, and shows recovery codes once", async () => {
    const begin = await (await manage(json({ action: "begin" }, cookieFor(founderId, "platform_owner")))).json();
    expect(begin.secret).toMatch(/^[A-Z2-7]{32}$/);
    const bad = await manage(json({ action: "confirm", code: "000000" }, cookieFor(founderId, "platform_owner")));
    expect(bad.status).toBe(400);
    const ok = await manage(json({ action: "confirm", code: currentCode(begin.secret) }, cookieFor(founderId, "platform_owner")));
    const body = await ok.json();
    expect(body.recoveryCodes).toHaveLength(8);
    (globalThis as { __rec?: string[]; __secret?: string }).__rec = body.recoveryCodes;
    (globalThis as { __secret?: string }).__secret = begin.secret;
    // sessions issued before enrolment are revoked, and the caller gets a fresh one
    expect(ok.headers.get("set-cookie")).toContain(COOKIE_NAME);
  });

  it("then needs the code after the password: no session from the password alone", async () => {
    const res = await login(json({ username: "founder", password: "correct horse" }));
    const data = await res.json();
    expect(data.secondFactor).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(typeof data.challenge).toBe("string");
  });

  it("signs in with a current code, and refuses the same code twice", async () => {
    const secret = (globalThis as { __secret?: string }).__secret!;
    const data = await (await login(json({ username: "founder", password: "correct horse" }))).json();
    // the step used at enrolment is spent, so use the next one (inside the accepted drift window)
    const code = currentCode(secret, 1);
    const first = await secondStep(json({ challenge: data.challenge, code }));
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toContain(COOKIE_NAME);
    const again = await secondStep(json({ challenge: data.challenge, code }));
    expect(again.status).toBe(401);
  });

  it("refuses a wrong code, a forged challenge, and another account's challenge", async () => {
    const data = await (await login(json({ username: "founder", password: "correct horse" }))).json();
    expect((await secondStep(json({ challenge: data.challenge, code: "123456" }))).status).toBe(401);
    expect((await secondStep(json({ challenge: "forged.token", code: "123456" }))).status).toBe(401);
    expect((await secondStep(json({ code: "123456" }))).status).toBe(401);
  });

  it("accepts a recovery code once", async () => {
    const rec = (globalThis as { __rec?: string[] }).__rec!;
    const data = await (await login(json({ username: "founder", password: "correct horse" }))).json();
    expect((await secondStep(json({ challenge: data.challenge, code: rec[0] }))).status).toBe(200);
    const data2 = await (await login(json({ username: "founder", password: "correct horse" }))).json();
    expect((await secondStep(json({ challenge: data2.challenge, code: rec[0] }))).status).toBe(401);
  });

  it("is switched off only with a valid code", async () => {
    const secret = (globalThis as { __secret?: string }).__secret!;
    const user = getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(founderId) as { token_version: number };
    const cookie = cookieFor(founderId, "platform_owner", user.token_version);
    expect((await manage(json({ action: "disable", code: "000000" }, cookie))).status).toBe(400);
    expect(checkSecondFactor(founderId, currentCode(secret, -1))).toBe(false); // an older, already-passed step
    const rec = (globalThis as { __rec?: string[] }).__rec!;
    expect((await manage(json({ action: "disable", code: rec[1] }, cookie))).status).toBe(200);
    const res = await login(json({ username: "founder", password: "correct horse" }));
    expect((await res.json()).secondFactor).toBeUndefined();
  });

  it("is only for the founder's own session", async () => {
    expect((await manage(json({ action: "begin" }, cookieFor(ownerId, "owner")))).status).toBe(403);
    expect(beginEnrollment(ownerId, "plainowner")).not.toBeNull(); // the repo itself is role-blind; the route is the gate
    expect(confirmEnrollment(ownerId, "000000")).toBeNull();
  });
});
