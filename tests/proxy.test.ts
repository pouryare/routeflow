import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROLES, type Role } from "@/lib/roles";

process.env.SESSION_SECRET = "test-secret";

const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { appTabs } = await import("@/lib/appNav");
const { NextRequest } = await import("next/server");

function req(pathname: string, role?: Role) {
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
    expect(proxy(req("/sales/admin/users", "delivery_driver")).status).toBe(307);
  });
  it("403s a non-driver hitting a driver API route", () => {
    expect(proxy(req("/api/driver/run", "group_manager")).status).toBe(403);
  });
  it("lets a van role sign out and read its own session", () => {
    for (const role of ["delivery_driver", "field_rep"] as const) {
      for (const p of ["/api/logout", "/api/me", "/api/prefs"]) {
        expect(proxy(req(p, role)).status, `${role} ${p}`).toBe(200);
      }
    }
  });
  it("lets a driver into /driver", () => {
    expect(proxy(req("/driver", "delivery_driver")).status).toBe(200);
  });
  it("sends a driver hitting a normal page back to their own", () => {
    const res = proxy(req("/planner", "delivery_driver"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/driver");
  });
  it("sends a driver hitting the lead pool back to their own day", () => {
    // /leads is the office now. The pool is the pin board, /driver is My Day, and both
    // kinds of work a driver holds are on the second one -- so a driver asking for the
    // pool is asking for a page that holds none of their work.
    const res = proxy(req("/leads", "delivery_driver"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/driver");
  });
  it("lets a driver record the visit at the door", () => {
    // The route has admitted a driver in requireRole since it was written, but it sits
    // under /api/leads, which this gate did not allowlist -- so the request was refused
    // here and the route never ran. A driver could not record a visit at all.
    expect(proxy(req("/api/leads/locations/7/visit", "delivery_driver")).status).toBe(200);
  });
  it("still sends a driver back from the rest of the shell", () => {
    const res = proxy(req("/sales/orders", "delivery_driver"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/driver");
  });
});

/* platform_owner vs. the pin pool.
 *
 * The isPinPool gate listed its roles as literals:
 *
 *     claims.role !== "owner" && claims.role !== "group_manager" && ...
 *
 * which is correct for every role except ONE. `OWNER_ROLES` is
 * ["platform_owner", "owner"] — platform_owner is a documented strict superset of
 * owner (lib/roles.ts:68) — so the platform's own god key was sent from /leads to
 * /crm by a gate that read exactly like the three around it. Written in 07b3f45,
 * and the accounting section came to the same trap and avoided it, which is how
 * this was noticed at all.
 *
 * Asserted BOTH ways: platform_owner must reach the pool, and the roles that
 * genuinely may not must still be refused. A fix that simply widened the gate
 * would pass the first assertion alone. */
describe("the pin pool admits platform_owner", () => {
  const reachable = (role: Role) => {
    const res = proxy(req("/leads", role));
    return res.status === 200;
  };

  it("lets platform_owner through", () => {
    expect(reachable("platform_owner")).toBe(true);
  });

  it("still lets the owner-side roles through", () => {
    expect(reachable("owner")).toBe(true);
    expect(reachable("group_manager")).toBe(true);
    expect(reachable("rep_manager")).toBe(true);
  });

  it("still refuses everyone it was written to refuse", () => {
    for (const role of ["phone_sales", "field_rep", "delivery_driver"] as Role[]) {
      expect(reachable(role), `${role} must not reach /leads`).toBe(false);
    }
  });

  it("is written with OWNER_ROLES, not a literal — the bug cannot come back", () => {
    const src = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
    // Comments are stripped before the scan. This file's new comment QUOTES the old
    // condition verbatim, so a raw grep flags the explanation of the bug as the bug. That
    // is the same trap as M39 in the accounting screens: a test that greps for a string
    // will happily match your comment about that string.
    const code = src
      .slice(src.indexOf("isPinPool"), src.indexOf("isAccounting"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).toMatch(/OWNER_ROLES\.includes\(claims\.role\)/);
    expect(code).not.toMatch(/claims\.role\s*!==\s*["']owner["']/);
  });

  it("and the nav agrees — it was hiding the same tab from platform_owner", () => {
    // The gate was only half the bug: `isRepLead` used the literal too, so the TAB was
    // missing as well. One constant, two call sites, one edit -- that is the point of it.
    const src = readFileSync(path.join(process.cwd(), "lib/appNav.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    expect(src).toMatch(/isRepLead = \(r: Role\) => OWNER_ROLES\.includes\(r\)/);
    expect(src).toMatch(/isManager = \(r: Role\) => OWNER_ROLES\.includes\(r\)/);
  });
});

/** The nav and the gate are written down in two files, so they drift. This is the test
 *  that makes the driver menu an assertion rather than a claim: every tab the menu marks
 *  ready is put in front of the middleware, and a redirect fails. Next prefetches every
 *  <Link>, so a tab the gate refuses is a console 404 before anyone clicks it. */
describe("a driver's menu and this gate agree", () => {
  it("never offers a tab the gate would send the driver back from", () => {
    for (const t of appTabs({ role: "delivery_driver" }).filter((x) => x.ready)) {
      expect(proxy(req(t.href, "delivery_driver")).status, t.href).toBe(200);
    }
  });
});

/** The nav and the gate are two files, so they drift — and a ONE-DIRECTION mirror cannot
 *  see the failure that matters. The test above only asks "does the menu hide what the gate
 *  refuses?" It cannot see a tab the menu HIDES that the gate ADMITS, which is precisely
 *  what a fail-open gate looks like: a field rep with `field_rep` in the token satisfies
 *  every `role === "driver"` comparison by being false, so the gate waves them into the
 *  whole sales shell with no error anywhere.
 *
 *  Asserting BOTH directions is what turns that from an invisible security hole into a red
 *  test. */
describe("the menu and the gate agree, in BOTH directions", () => {
  /* /leads is now in PATHS. It used to be EXEMPT from this list, and the reason is worth
   * keeping, because the exemption was an admission.
   *
   * The page had no server-side role gate at all — it branched on `isManager` from
   * /api/me and simply did not fetch for a non-manager — and `isManager` is
   * `!isVanRole`, so a phone seller satisfied it. The proxy therefore COULD NOT refuse
   * /leads without breaking a driver's day, and the menu's `isRepLead` was the only thing
   * hiding it from a rep. Reachable but empty is a weaker promise than "refused".
   *
   * That is fixed (spec 2026-09-29-leads-manager-only-driver-my-day section 3.2): the
   * allowlist entry is gone, so a van role is sent to /driver, and a role that is not a
   * rep-lead is sent to /crm. The page is one audience now, so it can be on PATHS and the
   * both-directions assertion below is real for it. */
  /* Extended past the original six. Those six covered the paths the ORIGINAL gates
     governed; the OWNER_ROLES sweep also touched /sales/reps, /sales/tasks, /sales/cheques
     and /sales/forecast, and M53 proved none of them were watched -- breaking the cheques
     gate so that it denied EVERYONE still passed, because /sales/cheques was not on this
     list. A drift test that only watches the paths someone remembered is a list, not an
     invariant.

     A test cannot prove a list is complete. What it can do is cover every gate that has a
     `ready:` in appNav, which is what these four are. If a fifth gate appears, the next
     person to add it here inherits the trap; the failure mode is visible either way. */
  const PATHS = [
    "/crm",
    "/report",
    "/sales/orders",
    "/driver",
    "/sales/pocket",
    "/leads",
    "/sales/reps",
    "/sales/tasks",
    "/sales/cheques",
    "/sales/forecast",
  ];

  /* The ONE admitted-without-a-tab case, and it is deliberate (spec §4.3 / P9).
   *
   * /driver is admitted for a platform_owner so the NotAVanNotice can render and offer the
   * switcher — without the exemption the request is bounced here and the notice never
   * appears. The notice is deliberately NOT a nav tab: it is a dead end by design, and a
   * tab advertising it would invite people to click something that only ever says "no".
   *
   * So the bidirectional invariant below is stated for every role EXCEPT this one pair,
   * rather than weakened globally. An exception named here is a decision; an exception
   * smuggled in by relaxing the loop is a hole. */
  const ADMITTED_WITHOUT_A_TAB = new Set(["platform_owner→/driver"]);

  for (const role of ROLES) {
    it(`keeps ${role}'s menu and the gate telling the same story`, () => {
      const shown = new Set(appTabs({ role } as never).filter((t) => t.ready).map((t) => t.href));
      for (const href of PATHS) {
        if (ADMITTED_WITHOUT_A_TAB.has(`${role}→${href}`)) continue;
        const admitted = proxy(req(href, role)).status === 200;
        expect(admitted, `${role} → ${href}`).toBe(shown.has(href));
      }
    });
  }

  it("admits a platform_owner to /driver precisely so the notice can offer the switcher", () => {
    expect(proxy(req("/driver", "platform_owner")).status).toBe(200);
    /* Everyone who is genuinely not a van role still bounces. `field_rep` is DELIBERATELY
       absent from this list: it is a van role, so being admitted here is the pre-existing
       design and has nothing to do with the notice. Listing it was my mistake — it would
       have "passed" for the wrong reason if the exemption had been opened up. */
    for (const role of ["owner", "group_manager", "phone_sales", "rep_manager"]) {
      expect(proxy(req("/driver", role as never)).status, role).not.toBe(200);
    }
  });

  it("keeps a field rep out of the surfaces a driver must not reach", () => {
    // Stated as intent, so nobody "fixes" a failure by loosening it.
    for (const href of ["/report", "/analytics", "/crm", "/sales/orders"]) {
      expect(proxy(req(href, "field_rep")).status, href).not.toBe(200);
    }
  });

  it("does not hand driver-only surfaces to a phone sales rep", () => {
    expect(proxy(req("/driver", "phone_sales")).status).not.toBe(200);
    expect(proxy(req("/api/crm/driver-visits", "phone_sales")).status).not.toBe(200);
  });

  it("gives both van roles the SAME tabs, or the two have drifted", () => {
    // Spec D6: they are one working day. A field rep handed nineteen tabs and a driver
    // three is the fail-open shape wearing a menu.
    expect(appTabs({ role: "field_rep" } as never)).toEqual(appTabs({ role: "delivery_driver" } as never));
  });

  it("gives a van role only the van menu", () => {
    expect(appTabs({ role: "field_rep" } as never).filter((t) => t.ready).length).toBe(2);
    expect(appTabs({ role: "delivery_driver" } as never).filter((t) => t.ready).length).toBe(2);
  });

  it("refuses a phone sales rep the pin pool, and sends them where their leads actually live", () => {
    // This is the hole the both-directions note below used to EXEMPT and document: /leads
    // had no server-side role gate at all, and `isManager` is `!isVanRole`, so a rep
    // satisfied it and reached the pool AND the «سپردن مسیر» hand-off on a URL nobody
    // checked. The nav hid it (isRepLead); the gate did not. Now both agree.
    const res = proxy(req("/leads", "phone_sales"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/crm");
    const shown = new Set(appTabs({ role: "phone_sales" } as never).filter((t) => t.ready).map((t) => t.href));
    expect(shown.has("/leads")).toBe(false);
  });
});

describe("a salesperson", () => {
  it("may open the sales section", () => {
    expect(proxy(req("/sales", "phone_sales")).status).toBe(200);
    expect(proxy(req("/sales/orders/new", "phone_sales")).status).toBe(200);
  });

  it("is not blocked from the map by the coarse gate", () => {
    // What they can actually read there is decided per route by requireRole, which still
    // names only owner and group_manager. Those widen as the sales screens land.
    expect(proxy(req("/", "phone_sales")).status).toBe(200);
  });

  it("is kept out of /sales/admin", () => {
    const res = proxy(req("/sales/admin/users", "phone_sales"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/");
  });

  it("is kept out of the driver app", () => {
    expect(proxy(req("/driver", "phone_sales")).status).toBe(307);
  });

  it("is kept out of the group-wide analytics page", () => {
    // /analytics aggregates the whole group's revenue and debt. A salesperson sees only
    // their own orders, so the aggregate is a leak -- they get /sales/me instead.
    const res = proxy(req("/analytics", "phone_sales"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/sales");
  });

  it("is kept out of the group-wide report page", () => {
    // Same shape as /analytics: whole-group coverage tables, and a CSV export button
    // that hands the reader every row behind them.
    expect(proxy(req("/report", "phone_sales")).status).toBe(307);
  });

  it("does not lock out the roles that page is for", () => {
    expect(proxy(req("/analytics", "owner")).status).toBe(200);
    expect(proxy(req("/analytics", "group_manager")).status).toBe(200);
  });
});

describe("CRM", () => {
  it("keeps drivers out of the CRM page and API, except their visits", () => {
    expect(proxy(req("/crm", "delivery_driver")).status).toBe(307);
    expect(proxy(req("/api/crm/businesses", "delivery_driver")).status).toBe(403);
    expect(proxy(req("/api/crm/driver-visits", "delivery_driver")).status).toBe(200);
  });
  it("lets a salesperson in", () => {
    expect(proxy(req("/crm", "phone_sales")).status).toBe(200);
    expect(proxy(req("/api/crm/businesses", "phone_sales")).status).toBe(200);
  });
});
