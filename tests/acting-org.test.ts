import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* The platform_owner's acting company: the founder's single account sees every company by default,
 * and can choose one to act as its owner, reads and writes, then go back. Nobody else can. */

const testDbPath = path.join(os.tmpdir(), `rf-acting-org-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { createSessionToken, parseSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { getSessionFromCookies, orderFilter, scopeGroupIds, groupFilter, orgScopeId, canReachOrg, canReachGroup, orgFilter } = await import("@/lib/session");
const { GET, POST } = await import("@/app/api/admin/acting-org/route");
const { NextRequest } = await import("next/server");
const { catalogueFor } = await import("@/lib/repo/sessionReads");
const { ordersListFor } = await import("@/lib/repo/ordersView");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
let founderId = 0;

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
  founderId = Number(
    getDb()
      .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES ('founder', 'x:y', 'founder', 'platform_owner', NULL, 1, '2026-01-01', 1)")
      .run().lastInsertRowid
  );
});

const token = (extra: { ao?: number; uid?: number; role?: "platform_owner" | "owner" | "group_manager"; act?: number } = {}) =>
  createSessionToken({ uid: extra.uid ?? founderId, role: extra.role ?? "platform_owner", gid: null, oid: 1, tv: 0, name: "f", ...(extra.ao ? { ao: extra.ao } : {}), ...(extra.act ? { act: extra.act } : {}) });
const req = (tok: string, method: "GET" | "POST", body?: unknown) =>
  new NextRequest("http://localhost/api/admin/acting-org", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${tok}` },
  });
const cookieOf = (res: Response) => /coverage_session_v2=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";

describe("the session of a platform_owner", () => {
  it("sees every company by default, and writes land in the home company", () => {
    const s = getSessionFromCookies(token())!;
    expect(s.role).toBe("platform_owner");
    expect(s.actingOrg ?? null).toBeNull();
    expect(s.organizationId).toBe(1);
    expect(orgScopeId(s)).toBeNull();
    expect(scopeGroupIds(s)).toBe("all");
    expect(canReachOrg(s, 2)).toBe(true);
    const orders = ordersListFor(s).orders.map((o) => o.id);
    expect(orders).toEqual(expect.arrayContaining([a.orderId, b.orderId]));
  });

  it("acting in a company, reads and writes are that company's: the founder is its owner", () => {
    const s = getSessionFromCookies(token({ ao: 2 }))!;
    expect(s.role).toBe("platform_owner"); // role gates (OWNER_ROLES, MANAGE_ROLES) still pass
    expect(s.actingOrg).toBe(2);
    expect(s.organizationId).toBe(2);
    expect(orgScopeId(s)).toBe(2);
    expect(orgFilter(s, "x.organization_id")).toEqual({ sql: " AND x.organization_id = ?", params: [2] });
    expect(canReachOrg(s, 2)).toBe(true);
    expect(canReachOrg(s, 1)).toBe(false);
    expect(canReachGroup(s, b.groupId)).toBe(true);
    expect(canReachGroup(s, a.groupId)).toBe(false);
    expect(scopeGroupIds(s)).toEqual([b.groupId]);
    expect(groupFilter(s).params).toEqual([2]);
    expect(orderFilter(s).sql).toContain("organization_id");
    // The pages' reads follow: org B's orders and catalogue, nothing of org A's.
    expect(ordersListFor(s).orders.map((o) => o.id)).toEqual([b.orderId]);
    expect(catalogueFor(s).map((p) => p.id)).toEqual([b.productId]);
  });

  it("ignores an acting company that does not exist or is inactive, falling back to all companies", () => {
    expect(getSessionFromCookies(token({ ao: 999 }))!.actingOrg ?? null).toBeNull();
    getDb().prepare("UPDATE organizations SET active = 0 WHERE id = 2").run();
    expect(getSessionFromCookies(token({ ao: 2 }))!.actingOrg ?? null).toBeNull();
    getDb().prepare("UPDATE organizations SET active = 1 WHERE id = 2").run();
  });

  it("grants nothing to anyone else who carries the claim", () => {
    const owner = getSessionFromCookies(token({ uid: a.ownerId, role: "owner", ao: 2 }))!;
    expect(owner.actingOrg ?? null).toBeNull();
    expect(owner.organizationId).toBe(1);
    expect(orgScopeId(owner)).toBe(1);
    expect(canReachOrg(owner, 2)).toBe(false);
  });

  it("ignores the claim during Login-As: an impersonated session is exactly the target's", () => {
    const targetId = a.managerId;
    const s = getSessionFromCookies(token({ uid: targetId, role: "group_manager", ao: 2, act: founderId }));
    expect(s?.actingOrg ?? null).toBeNull();
    expect(s?.organizationId).toBe(1);
  });
});

describe("/api/admin/acting-org", () => {
  it("is for a platform_owner only", async () => {
    expect((await GET(req(token({ uid: a.ownerId, role: "owner" }), "GET"))).status).toBe(403);
    expect((await POST(req(token({ uid: a.ownerId, role: "owner" }), "POST", { organization_id: 2 }))).status).toBe(403);
    expect((await POST(new NextRequest("http://localhost/api/admin/acting-org", { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("lists the companies and the current choice", async () => {
    const body = await (await GET(req(token(), "GET"))).json();
    expect(body.organizations.map((o: { id: number }) => o.id)).toEqual(expect.arrayContaining([1, 2]));
    expect(body.acting).toBeNull();
    expect(body.home).toBe(1);
    const acting = await (await GET(req(token({ ao: 2 }), "GET"))).json();
    expect(acting.acting).toBe(2);
  });

  it("switches into a company, signs a new token carrying it, and records the switch", async () => {
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM platform_access_log WHERE organization_id = 2").get() as { n: number }).n;
    const res = await POST(req(token(), "POST", { organization_id: 2 }));
    expect(res.status).toBe(200);
    const claims = parseSessionToken(cookieOf(res))!;
    expect(claims.ao).toBe(2);
    expect(claims.uid).toBe(founderId);
    expect(claims.act).toBeUndefined();
    const s = getSessionFromCookies(cookieOf(res))!;
    expect(s.actingOrg).toBe(2);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM platform_access_log WHERE organization_id = 2").get() as { n: number }).n).toBe(before + 1);
  });

  it("goes back to all companies, dropping the claim", async () => {
    const res = await POST(req(token({ ao: 2 }), "POST", { organization_id: null }));
    expect(res.status).toBe(200);
    expect(parseSessionToken(cookieOf(res))!.ao).toBeUndefined();
    expect(getSessionFromCookies(cookieOf(res))!.actingOrg ?? null).toBeNull();
  });

  it("refuses an unknown or inactive company, and a malformed id", async () => {
    expect((await POST(req(token(), "POST", { organization_id: 999 }))).status).toBe(404);
    expect((await POST(req(token(), "POST", { organization_id: 1.5 }))).status).toBe(400);
    expect((await POST(req(token(), "POST", { organization_id: "x" }))).status).toBe(400);
  });

  it("will not switch from inside Login-As", async () => {
    const res = await POST(req(token({ uid: a.managerId, role: "group_manager", act: founderId }), "POST", { organization_id: 2 }));
    expect(res.status).toBe(403);
  });
});
