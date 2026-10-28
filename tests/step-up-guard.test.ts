import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-stepup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { hashPassword, createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { totpAt, stepAt } = await import("@/lib/totp");
const { NextRequest } = await import("next/server");
const { POST: manage } = await import("@/app/api/me/second-factor/route");
const { POST: stepUp } = await import("@/app/api/me/step-up/route");
const { getSession } = await import("@/lib/session");
const { guardStepUp, setStepUpRequired } = await import("@/lib/repo/stepUp");
const { TRUST_COOKIE } = await import("@/lib/stepUp");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let enrolledId = 0;
let plainId = 0;
let secret = "";

const sessionCookie = (uid: number) => `${COOKIE_NAME}=${createSessionToken({ uid, role: "owner", gid: null, oid: 1, tv: 0, name: "t" })}`;
const req = (url: string, cookie: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie },
  });
const code = (offset = 0) => totpAt(secret, stepAt(Date.now()) + offset);
const asSession = async (uid: number, cookie = sessionCookie(uid)) => (await getSession(req("/x", cookie)))!;

beforeAll(async () => {
  const ins = getDb().prepare("INSERT INTO users (username, password_hash, display_name, role, active, token_version, created_at, organization_id) VALUES (?, ?, ?, 'owner', 1, 0, '2026-01-01', 1)");
  enrolledId = Number((await ins.run("enrolled", hashPassword("pw-long-enough"), "E")).lastInsertRowid);
  plainId = Number((await ins.run("plain", hashPassword("pw-long-enough"), "P")).lastInsertRowid);
  const begin = await (await manage(req("/api/me/second-factor", sessionCookie(enrolledId), { action: "begin" }))).json();
  secret = begin.secret;
  await manage(req("/api/me/second-factor", sessionCookie(enrolledId), { action: "confirm", code: code() }));
});

describe("step-up guard", () => {
  it("lets everything through while the company has not switched it on", async () => {
    await setStepUpRequired(1, false);
    expect(await guardStepUp(req("/x", ""), await asSession(plainId), "price_change")).toBeNull();
  });

  it("asks for a code once switched on, and tells a person with no authenticator to enrol", async () => {
    await setStepUpRequired(1, true);
    const asked = await guardStepUp(req("/x", ""), await asSession(enrolledId, sessionCookieFresh()), "price_change");
    expect(asked?.status).toBe(403);
    expect((await asked!.json()).step_up).toMatchObject({ action: "price_change", method: "totp", critical: false });
    const enrol = await guardStepUp(req("/x", ""), await asSession(plainId), "hard_delete");
    expect((await enrol!.json()).step_up).toMatchObject({ method: "enroll", critical: true });
  });

  it("trusts the device for ten minutes after a right code, and a code works once", async () => {
    await setStepUpRequired(1, true);
    const cookie = sessionCookieFresh();
    const wrong = await stepUp(req("/api/me/step-up", cookie, { code: "000000" }));
    expect(wrong.status).toBe(400);
    const good = code(1); // enrolment already used this step's code
    const ok = await stepUp(req("/api/me/step-up", cookie, { code: `${good.slice(0, 3)} ${good.slice(3)}` }));
    expect(ok.status).toBe(200);
    const trust = ok.cookies.get(TRUST_COOKIE)!.value;
    expect(await guardStepUp(req("/x", `${cookie}; ${TRUST_COOKIE}=${trust}`), await asSession(enrolledId, cookie), "price_change")).toBeNull();
    // the same code again is a replay
    expect((await stepUp(req("/api/me/step-up", cookie, { code: good }))).status).toBe(400);
    // someone else's trust cookie does not count
    expect(await guardStepUp(req("/x", `${TRUST_COOKIE}=${trust}`), await asSession(plainId), "price_change")).not.toBeNull();
  });
});

/** Enrolment bumps token_version, so the session cookie must carry the current one. */
function sessionCookieFresh() {
  return `${COOKIE_NAME}=${createSessionToken({ uid: enrolledId, role: "owner", gid: null, oid: 1, tv: 1, name: "t" })}`;
}
