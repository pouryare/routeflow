import { describe, expect, test } from "vitest";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";

describe("the role list", () => {
  test("is the four roles the app has", () => {
    expect(ROLES).toEqual(["owner", "group_manager", "salesperson", "driver"]);
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

describe("Role", () => {
  test("accepts each member of ROLES", () => {
    const roles: Role[] = ["owner", "group_manager", "salesperson", "driver"];
    expect(roles).toHaveLength(4);
  });
});
