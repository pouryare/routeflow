import { describe, it, expect } from "vitest";

process.env.SESSION_SECRET = "test-secret";

const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

function req(pathname: string, role?: "owner" | "group_manager" | "driver") {
  const headers: Record<string, string> = {};
  if (role) {
    const token = createSessionToken({ uid: 1, role, gid: role === "owner" ? null : 2, tv: 0, name: "t" });
    headers.cookie = `${COOKIE_NAME}=${token}`;
  }
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("public paths", () => {
  it("lets the login page through unauthenticated", () => {
    expect(proxy(req("/login")).status).toBe(200);
  });
  it("lets the service worker through unauthenticated", () => {
    expect(proxy(req("/sw.js")).status).toBe(200);
  });
});

describe("authentication", () => {
  it("redirects an anonymous page request to login", () => {
    const res = proxy(req("/planner"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
  it("401s an anonymous API request", () => {
    expect(proxy(req("/api/customers")).status).toBe(401);
  });
});

describe("the retired shared-password session", () => {
  it("treats a uid-0 cookie as signed out rather than letting it half-work", () => {
    // Those cookies were minted by the shared-password login and are still validly
    // signed for 30 days. getSession() rejects uid 0 because it matches no row, so
    // without this the holder would load every page and have every API call fail.
    const token = createSessionToken({ uid: 0, role: "owner", gid: null, tv: 0, name: "مدیر" });
    const legacy = (pathname: string) =>
      new NextRequest(`http://localhost${pathname}`, { headers: { cookie: `${COOKIE_NAME}=${token}` } });

    const page = proxy(legacy("/planner"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    expect(proxy(legacy("/api/customers")).status).toBe(401);
  });
});

describe("role prefixes", () => {
  it("lets an owner into /admin", () => {
    expect(proxy(req("/admin/users", "owner")).status).toBe(200);
  });
  it("keeps a group manager out of /admin", () => {
    const res = proxy(req("/admin/users", "group_manager"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/");
  });
  it("keeps a driver out of /admin", () => {
    expect(proxy(req("/admin/users", "driver")).status).toBe(307);
  });
  it("403s a non-driver hitting a driver API route", () => {
    expect(proxy(req("/api/driver/run", "group_manager")).status).toBe(403);
  });
  it("lets a driver into /driver", () => {
    expect(proxy(req("/driver", "driver")).status).toBe(200);
  });
  it("sends a driver hitting a normal page back to their own", () => {
    const res = proxy(req("/planner", "driver"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/driver");
  });
});
