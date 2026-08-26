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

describe("Role", () => {
  test("accepts each member of ROLES", () => {
    const roles: Role[] = ["owner", "group_manager", "salesperson", "driver"];
    expect(roles).toHaveLength(4);
  });
});
