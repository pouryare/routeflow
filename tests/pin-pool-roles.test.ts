import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MANAGE_ROLES, PIN_POOL_ROLES } from "@/lib/roles";

/* The pin pool's page gate (proxy.ts), its nav tab (appNav.ts) and its data routes must agree.
   The nav and gate already admitted the rep manager; the routes did not, so the page opened onto
   a wall of 403s. This holds the routes to the same list. */
const ROUTES = [
  "app/api/locations/route.ts",
  "app/api/locations/[id]/route.ts",
  "app/api/locations/[id]/convert/route.ts",
  "app/api/locations/parse/route.ts",
  "app/api/locations/parse/[jobId]/route.ts",
  "app/api/locations/parse/[jobId]/cancel/route.ts",
  "app/api/locations/parse/[jobId]/undo/route.ts",
  "app/api/locations/parse/latest/route.ts",
  "app/api/lead-lists/route.ts",
  "app/api/lead-lists/[id]/route.ts",
  "app/api/lead-runs/route.ts",
  "app/api/lead-runs/[id]/route.ts",
  "app/api/leads/locations/[id]/visit/route.ts",
];

describe("pin pool roles", () => {
  it("is the managers plus the rep manager, and nobody else", () => {
    expect([...PIN_POOL_ROLES].sort()).toEqual([...MANAGE_ROLES, "rep_manager"].sort());
    expect(MANAGE_ROLES).not.toContain("rep_manager");
  });
  it.each(ROUTES)("%s admits PIN_POOL_ROLES", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("PIN_POOL_ROLES");
    expect(src).not.toMatch(/requireRole\(req, MANAGE_ROLES\)/);
  });
  it("the nav tab and the proxy gate admit the same roles", () => {
    expect(readFileSync("proxy.ts", "utf8")).toMatch(/isPinPool[\s\S]{0,200}rep_manager/);
    expect(readFileSync("lib/appNav.ts", "utf8")).toMatch(/"\/leads"[^\n]*isRepLead\(r\)/);
  });
});
