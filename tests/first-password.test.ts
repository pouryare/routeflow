import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-firstpw-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME, parseSessionToken, hashPassword, verifyPassword } = await import("@/lib/auth");
const { getSessionFromCookies } = await import("@/lib/session");
const { insertUser } = await import("@/lib/repo/usersAdmin");
const { findUserById } = await import("@/lib/users");
const { planUserPatch } = await import("@/lib/userPatchPlan");
const { proxy } = await import("@/proxy");
const login = (await import("@/app/api/login/route")).POST;
const change = (await import("@/app/api/me/password/route")).POST;

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function newStaff(username: string): number {
  const groupId = Number(
    getDb().prepare("INSERT INTO groups (name, slug, organization_id, created_at) VALUES (?, ?, 1, '2026-01-01')").run(`g-${username}`, `g-${username}`).lastInsertRowid
  );
  return insertUser({
    username,
    passwordHash: hashPassword("given-by-owner"),
    displayName: username,
    role: "phone_sales",
    groupId,
    staffCode: null,
    phone: null,
    organizationId: 1,
  });
}

const cookieOf = (res: Response) => {
  const raw = res.headers.get("set-cookie") ?? "";
  return decodeURIComponent(raw.split(";")[0].split("=").slice(1).join("="));
};

const jsonReq = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });

const pageReq = (pathname: string, cookie: string) =>
  new NextRequest(`http://localhost${pathname}`, { headers: { cookie: `${COOKIE_NAME}=${cookie}` } });

describe("a password an owner chose must be replaced (F35)", () => {
  it("marks a new account, and the sign-in carries the mark", async () => {
    const id = newStaff("fp-new");
    expect(findUserById(id)?.must_change_password).toBe(1);
    const res = await login(jsonReq("/api/login", { username: "fp-new", password: "given-by-owner" }));
    expect(res.status).toBe(200);
    expect(parseSessionToken(cookieOf(res))?.pw).toBe(1);
  });

  it("sends every page and API to the form, but lets the form, its route and sign-out through", () => {
    const cookie = createSessionToken({ uid: 1, role: "phone_sales", gid: 2, oid: 1, tv: 0, name: "t", pw: 1 });
    const page = proxy(pageReq("/sales/today", cookie));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/password");
    expect(proxy(pageReq("/api/customers", cookie)).status).toBe(403);
    for (const open of ["/password", "/api/me/password", "/api/logout", "/icon.svg"]) {
      expect(proxy(pageReq(open, cookie)).status, open).toBe(200);
    }
    const plain = createSessionToken({ uid: 1, role: "phone_sales", gid: 2, oid: 1, tv: 0, name: "t" });
    expect(proxy(pageReq("/sales/today", plain)).status).toBe(200);
  });

  it("saving a new password clears the mark, ends other sessions and keeps this one", async () => {
    const id = newStaff("fp-change");
    const user = findUserById(id)!;
    const cookie = createSessionToken({ uid: id, role: user.role, gid: user.group_id, oid: 1, tv: 0, name: "t", pw: 1 });
    const other = createSessionToken({ uid: id, role: user.role, gid: user.group_id, oid: 1, tv: 0, name: "t" });

    expect((await change(jsonReq("/api/me/password", { password: "short" }, cookie))).status).toBe(400);

    const res = await change(jsonReq("/api/me/password", { password: "only-i-know-it" }, cookie));
    expect(res.status).toBe(200);
    const after = findUserById(id)!;
    expect(after.must_change_password).toBe(0);
    expect(verifyPassword("only-i-know-it", after.password_hash)).toBe(true);
    const fresh = parseSessionToken(cookieOf(res));
    expect(fresh?.pw).toBeUndefined();
    expect(fresh?.tv).toBe(1);
    expect(getSessionFromCookies(cookieOf(res))?.user.id).toBe(id);
    expect(getSessionFromCookies(other)).toBeNull();
  });

  it("an owner's reset of someone else marks them again; changing their own does not", () => {
    const id = newStaff("fp-reset");
    const target = findUserById(id)!;
    const forOther = planUserPatch({ password: "reset-by-owner" }, target, 1, 999);
    expect(forOther.ok && forOther.sets).toContain("must_change_password = 1");
    const forSelf = planUserPatch({ password: "my-own-choice" }, target, 1, id);
    expect(forSelf.ok && forSelf.sets).not.toContain("must_change_password = 1");
  });

  it("refuses an owner acting as someone else", async () => {
    const id = newStaff("fp-acted");
    const user = findUserById(id)!;
    const ownerId = Number(
      getDb()
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, token_version, created_at)
           VALUES ('fp-owner', 'x', 'o', 'owner', 1, 1, 0, '2026-01-01')`
        )
        .run().lastInsertRowid
    );
    const cookie = createSessionToken({ uid: id, role: user.role, gid: user.group_id, oid: 1, tv: 0, name: "t", act: ownerId });
    const res = await change(jsonReq("/api/me/password", { password: "not-yours-to-pick" }, cookie));
    // Either refused outright, or the acting session is not valid at all; never a change.
    expect([401, 403]).toContain(res.status);
    expect(findUserById(id)?.must_change_password).toBe(1);
  });
});

describe("changing your own password by choice", () => {
  const voluntary = (username: string) => {
    const id = newStaff(username);
    getDb().prepare("UPDATE users SET must_change_password = 0 WHERE id = ?").run(id);
    const user = findUserById(id)!;
    const cookie = createSessionToken({ uid: id, role: user.role, gid: user.group_id, oid: 1, tv: 0, name: "t" });
    return { id, cookie };
  };

  it("asks for the current password, and a wrong one changes nothing", async () => {
    const { id, cookie } = voluntary("vp-wrong");
    expect((await change(jsonReq("/api/me/password", { password: "a-new-secret" }, cookie))).status).toBe(400);
    const res = await change(jsonReq("/api/me/password", { password: "a-new-secret", current: "not-it" }, cookie));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("رمز فعلی درست نیست");
    expect(verifyPassword("given-by-owner", findUserById(id)!.password_hash)).toBe(true);
  });

  it("refuses a new password that is the current one", async () => {
    const { cookie } = voluntary("vp-same");
    const res = await change(jsonReq("/api/me/password", { password: "given-by-owner", current: "given-by-owner" }, cookie));
    expect(res.status).toBe(400);
  });

  it("with the right current password, saves it and ends other sessions", async () => {
    const { id, cookie } = voluntary("vp-ok");
    const res = await change(jsonReq("/api/me/password", { password: "a-new-secret", current: "given-by-owner" }, cookie));
    expect(res.status).toBe(200);
    expect(verifyPassword("a-new-secret", findUserById(id)!.password_hash)).toBe(true);
    expect(getSessionFromCookies(cookie)).toBeNull();
    expect(getSessionFromCookies(cookieOf(res))?.user.id).toBe(id);
  });

  it("slows guessing: the sixth wrong current password in a window is refused outright", async () => {
    const { cookie } = voluntary("vp-guess");
    for (let i = 0; i < 5; i++) {
      expect((await change(jsonReq("/api/me/password", { password: "a-new-secret", current: `guess-${i}` }, cookie))).status).toBe(400);
    }
    expect((await change(jsonReq("/api/me/password", { password: "a-new-secret", current: "given-by-owner" }, cookie))).status).toBe(429);
  });
});
