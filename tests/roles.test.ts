import { describe, expect, test } from "vitest";
import { ROLES, ROLE_LABEL, homePathFor, VAN_ROLES, isVanRole, type Role } from "@/lib/roles";

describe("the role list", () => {
  test("is the eight roles the app has, widest access first", () => {
    // platform_owner is the vendor account: RouteFlow is sold to other distributors, so
    // somebody has to be able to read across tenants to support them. Every other role
    // stops at the edge of its own organisation. rep_manager runs the representative
    // network for one organisation and sees no group territory.
    expect(ROLES).toEqual([
      "platform_owner",
      "owner",
      "group_manager",
      "rep_manager",
      "phone_sales",
      "field_rep",
      "delivery_driver",
      "shareholder",
    ]);
  });

  test("gives every role a Persian label", () => {
    // The admin screen used to keep its own copy of this union because it is a client
    // component and cannot import lib/db.ts. The two drifted the moment a role was
    // added, and a Record<Role, string> in one file cannot notice a union in another.
    for (const role of ROLES) {
      expect(ROLE_LABEL[role], `no label for ${role}`).toBeTruthy();
    }
  });

  test("has no label for a role that does not exist", () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...ROLES].sort());
  });

  test("is importable without pulling in the database", async () => {
    // The whole reason this module exists is that a client component cannot import
    // db.ts. Asserting it has no imports at all is stricter than banning node:sqlite by
    // name, and it cannot be fooled by the word appearing in a comment.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../lib/roles.ts", import.meta.url), "utf8")
    );
    const imports = source.split("\n").filter((l) => /^\s*(import|require)\b/.test(l));
    expect(imports).toEqual([]);
  });
});

describe("the bootstrap script", () => {
  test("knows the same roles as the app", async () => {
    // create-user.mjs cannot import lib/roles.ts -- it is plain ESM run by node with no
    // build step -- so it keeps its own copy of the list. That copy is exactly the kind
    // that drifts: it had already fallen behind once, and the failure mode is the owner
    // being unable to create the account type the sales section exists for.
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../scripts/create-user.mjs", import.meta.url), "utf8");
    const match = /const ROLES = \[([^\]]*)\]/.exec(source);
    expect(match, "no ROLES literal in create-user.mjs").toBeTruthy();

    const scriptRoles = match![1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect(scriptRoles).toEqual(ROLES);
  });
});

describe("homePathFor", () => {
  test("sends a van role to their own app and everyone else to the day's briefing", () => {
    // platform_owner used to be sent to /platform, a page that was never built — every
    // vendor login landed on a 404. /sales/today already scopes itself to "all" for them.
    expect(homePathFor("field_rep")).toBe("/driver");
    expect(homePathFor("delivery_driver")).toBe("/driver");
    expect(homePathFor("shareholder")).toBe("/my-share");
    for (const role of ROLES.filter((r) => !isVanRole(r) && r !== "shareholder")) {
      expect(homePathFor(role), role).toBe("/sales/today");
    }
  });
});

describe("the van roles", () => {
  test("groups the two roles that work a route in a vehicle", () => {
    // A gate keyed on ONE of these literals fails OPEN: with field_rep in the token,
    // `role === "driver"` is false, so the gate admits everything instead of refusing.
    // That is how a field rep ends up holding the whole sales shell. Gate on membership.
    expect(VAN_ROLES).toEqual(["field_rep", "delivery_driver"]);
    expect(isVanRole("field_rep")).toBe(true);
    expect(isVanRole("delivery_driver")).toBe(true);
  });

  test("does not treat anyone else as a van role", () => {
    for (const role of ROLES.filter((r) => !isVanRole(r))) {
      expect(isVanRole(role), role).toBe(false);
    }
  });
});

describe("Role", () => {
  test("accepts each member of ROLES", () => {
    const roles: Role[] = ["platform_owner", "owner", "group_manager", "phone_sales", "field_rep"];
    expect(roles).toHaveLength(5);
  });
});
