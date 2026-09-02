import { describe, it, expect } from "vitest";

process.env.SESSION_SECRET = "test-secret";

const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

function req(pathname: string, role?: "owner" | "group_manager" | "salesperson" | "driver") {
  const headers: Record<string, string> = {};
  if (role) {
    const token = createSessionToken({ uid: 1, role, gid: role === "owner" ? null : 2, oid: 1, tv: 0, name: "t" });
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
    const token = createSessionToken({ uid: 0, role: "owner", gid: null, oid: 1, tv: 0, name: "مدیر" });
    const legacy = (pathname: string) =>
      new NextRequest(`http://localhost${pathname}`, { headers: { cookie: `${COOKIE_NAME}=${token}` } });

    const page = proxy(legacy("/planner"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    expect(proxy(legacy("/api/customers")).status).toBe(401);
  });

  it("clears the dead cookie on the way out", () => {
    // Otherwise the browser keeps presenting a credential that can never work again, and
    // every navigation for the next 30 days takes the same round trip to be refused.
    const token = createSessionToken({ uid: 0, role: "owner", gid: null, oid: 1, tv: 0, name: "مدیر" });
    const res = proxy(
      new NextRequest("http://localhost/planner", { headers: { cookie: `${COOKIE_NAME}=${token}` } })
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it("tells the login page where the caller was headed", () => {
    // The login form reads this to explain that a session ended, rather than presenting a
    // bare form to someone who thought they were already signed in.
    const res = proxy(new NextRequest("http://localhost/planner"));
    expect(res.headers.get("location")).toContain("next=%2Fplanner");
  });
});

describe("role prefixes", () => {
  it("lets an owner into /sales/admin", () => {
    expect(proxy(req("/sales/admin/users", "owner")).status).toBe(200);
  });
  it("keeps a group manager out of /sales/admin", () => {
    const res = proxy(req("/sales/admin/users", "group_manager"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/");
  });
  it("keeps a driver out of /sales/admin", () => {
    expect(proxy(req("/sales/admin/users", "driver")).status).toBe(307);
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

describe("a salesperson", () => {
  it("may open the sales section", () => {
    expect(proxy(req("/sales", "salesperson")).status).toBe(200);
    expect(proxy(req("/sales/orders/new", "salesperson")).status).toBe(200);
  });

  it("is not blocked from the map by the coarse gate", () => {
    // What they can actually read there is decided per route by requireRole, which still
    // names only owner and group_manager. Those widen as the sales screens land.
    expect(proxy(req("/", "salesperson")).status).toBe(200);
  });

  it("is kept out of /sales/admin", () => {
    const res = proxy(req("/sales/admin/users", "salesperson"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/");
  });

  it("is kept out of the driver app", () => {
    expect(proxy(req("/driver", "salesperson")).status).toBe(307);
  });

  it("is kept out of the group-wide analytics page", () => {
    // /analytics aggregates the whole group's revenue and debt. A salesperson sees only
    // their own orders, so the aggregate is a leak -- they get /sales/me instead.
    const res = proxy(req("/analytics", "salesperson"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/sales");
  });

  it("is kept out of the group-wide report page", () => {
    // Same shape as /analytics: whole-group coverage tables, and a CSV export button
    // that hands the reader every row behind them.
    expect(proxy(req("/report", "salesperson")).status).toBe(307);
  });

  it("does not lock out the roles that page is for", () => {
    expect(proxy(req("/analytics", "owner")).status).toBe(200);
    expect(proxy(req("/analytics", "group_manager")).status).toBe(200);
  });
});
