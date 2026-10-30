import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hasSyncClient, ROLES } from "@/lib/roles";

/** The founder's browser was asking a question whose answer is permanently "no".
 *
 * `GET /api/sync/pull?since=now 403` was not a broken route. Both sync routes have always
 * refused a `platform_owner` — the vendor is not a field device, and there is no single
 * organisation whose rows a pull could hand them. What was broken is that AppShell mounted
 * <SyncStatus /> for EVERY role, and mounting it starts the engine, whose first act is to
 * ask. So the founder's browser asked on every page, every 30 s, forever, and was told no
 * every time. The refusal was right; the asking was the defect.
 *
 * The fix states the answer ONCE, here, so the shell can decline to ask — rather than a
 * third hand-written `role === "platform_owner"` that the next role change silently misses.
 */
describe("hasSyncClient", () => {
  it("is false for the vendor and the shareholder, true for every other role", () => {
    expect(hasSyncClient("platform_owner")).toBe(false);
    expect(hasSyncClient("shareholder")).toBe(false);
    for (const role of ROLES.filter((r) => r !== "platform_owner" && r !== "shareholder")) {
      expect(hasSyncClient(role), role).toBe(true);
    }
  });

  it("still admits the retired names, because they are drivers", () => {
    /* lib/roles.ts documents that 'driver' and 'salesperson' are RETIRED but still admitted
       by users.role's CHECK, and lib/session.ts launders them through `as Role` — so they
       arrive here as real runtime values, not as impossible input. Both name a van role,
       and a van role is exactly who the offline client exists for: a delivery driver
       working a route with no signal. Excluding them would break offline delivery for every
       account created before the split, silently and correctly-looking. */
    for (const retired of ["driver", "salesperson"]) {
      expect(hasSyncClient(retired as never), retired).toBe(true);
    }
  });

  it("is total over the union — no role falls through", () => {
    for (const role of ROLES) {
      expect(typeof hasSyncClient(role), role).toBe("boolean");
    }
  });

  it("is not derived from the management lists", () => {
    /* Deriving it from OWNER_ROLES/MANAGE_ROLES would look tidy and be wrong: those ask
       "is this person in charge", this asks "does this person work from a device that goes
       offline". Promotion must not silently enrol a role in the sync client. */
    const src = readFileSync("lib/roles.ts", "utf8");
    const body = /export function hasSyncClient[\s\S]*?\n}/.exec(src)?.[0] ?? "";
    expect(body).toContain('role !== "platform_owner"');
    expect(body).not.toMatch(/OWNER_ROLES|MANAGE_ROLES/);
  });
});

describe("the sync routes keep their own refusal", () => {
  /* The shell declining to ask is a HINT that spares the browser a request. It is not the
     thing standing between a cross-tenant pull and the wrong account — the route is. If the
     route ever loses this check, hasSyncClient above still passes and nothing catches it. */
  for (const verb of ["pull", "push"]) {
    it(`/api/sync/${verb} still refuses a platform_owner server-side`, () => {
      const src = readFileSync(`app/api/sync/${verb}/route.ts`, "utf8");
      expect(src).toContain("hasSyncClient");
      expect(src).toContain("403");
    });
  }

  it("neither route spells the role out by hand any more", () => {
    for (const verb of ["pull", "push"]) {
      const src = readFileSync(`app/api/sync/${verb}/route.ts`, "utf8");
      expect(src, verb).not.toMatch(/role === "platform_owner"/);
    }
  });
});

describe("the shell asks only when the answer can be yes", () => {
  it("no longer mounts the sync client unconditionally", () => {
    /* The defect, as an executable fact: AppShell mounted <SyncStatus /> for every role. */
    const shell = readFileSync("components/meridian/AppShell.tsx", "utf8");
    expect(shell).not.toMatch(/<SyncStatus\s*\/>/);
  });

  it("the gate that replaced it reads the session and asks hasSyncClient", () => {
    const gate = readFileSync("components/meridian/SyncIsland.tsx", "utf8");
    expect(gate).toContain("getSessionFromCookies");
    expect(gate).toContain("hasSyncClient");
    expect(gate).toContain("SyncStatus");
  });

  it("the gate sits behind its own Suspense, so it cannot block a navigation", () => {
    /* The shell layout is synchronous on purpose (tests/shellLayout.test.ts). A gate that
       awaited cookies() inline would put that await back on the critical path and silently
       disable every loading.tsx — the page-transition freeze this design exists to avoid. */
    const shell = readFileSync("components/meridian/AppShell.tsx", "utf8");
    expect(shell).toContain("SyncIsland");
    expect(shell).toMatch(/<Suspense[^>]*>\s*\{?\s*<SyncIsland/);
  });
});
describe("the sync pull compresses itself", () => {
  it("answers gzip when the client accepts it (next start leaves route-handler JSON uncompressed)", () => {
    const src = readFileSync("app/api/sync/pull/route.ts", "utf8");
    expect(src).toContain('"content-encoding": "gzip"');
    expect(src).toContain("accept-encoding");
  });
});
