import { describe, it, expect } from "vitest";
import { MANAGE_ROLES, type Role } from "@/lib/roles";

/* The design decision, stated as an executable fact (spec P3).
 *
 * Before this test the rule lived only in prose — and prose had already failed: 185 of 186
 * `requireRole` gates omitted `platform_owner`, and the ONE that included it did so by
 * accident. `lib/session.ts` has treated the role as all-powerful since Phase 0a
 * (`scopeGroupIds` → "all", `orgFilter` → empty); the gates were the only thing out of step.
 *
 * The second test walks the real source tree rather than a hand-maintained list, so a NEW
 * route that forgets the role fails here instead of in production. */
describe("platform_owner reach", () => {
  it("MANAGE_ROLES contains platform_owner, owner and group_manager", () => {
    expect(MANAGE_ROLES).toContain("platform_owner");
    expect(MANAGE_ROLES).toContain("owner");
    expect(MANAGE_ROLES).toContain("group_manager");
  });

  it("never grants management to a role that is not a manager", () => {
    for (const r of ["phone_sales", "field_rep", "delivery_driver", "rep_manager"] as Role[]) {
      expect(MANAGE_ROLES, r).not.toContain(r);
    }
  });

  it("no gate in app/api names owner but omits platform_owner", async () => {
    const { execFileSync } = await import("node:child_process");
    // -F: fixed-string, because "requireRole(req, [" is a REGEX character class in grep
    // and `grep: Invalid regular expression` is what an unescaped "[" buys you here.
    const out = execFileSync("grep", ["-rnF", "requireRole(req, [", "app/"], { encoding: "utf8" });
    const offenders = out
      .split("\n")
      .filter(Boolean)
      .filter((line) => {
        // A management gate names owner. Naming owner but not platform_owner is exactly the
        // defect this task exists to fix — and the defect that shipped for 190 call sites.
        return /"owner"/.test(line) && !/platform_owner|MANAGE_ROLES/.test(line);
      });
    expect(offenders, `gates naming owner but not platform_owner:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
