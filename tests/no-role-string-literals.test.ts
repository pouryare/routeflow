import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES } from "@/lib/roles";

/** A role name that no longer exists must not appear in a query.
 *
 *  lib/roles.ts exists because a hand-copied duplicate of the role union drifted the
 *  first time a role was added — "a `Record<Role, string>` in one file cannot notice a
 *  union that changed in another". The same failure came back twice through a different
 *  door, as a raw string in a query: `WHERE role = 'driver'` and
 *  `WHERE role = 'salesperson'` both matched nobody after lib/db.ts renamed those roles,
 *  and both emptied a live dropdown with no error anywhere.
 *
 *  The rule is deliberately NARROW, and the narrowing is the finding. An earlier draft of
 *  this test forbade EVERY `role = '…'` outside lib/roles.ts and lib/db.ts, and it
 *  reported 25 offenders — all of them spelling CURRENT role names correctly, in
 *  lib/commissionLedger.ts, lib/repo/notifications.ts, lib/delivery.ts and elsewhere.
 *  Forbidding those would mean rewriting 25 correct call sites to import a constant,
 *  which is a large risky diff in service of a bug that never occurred.
 *
 *  So the guard asks the question that actually catches the bug: is the name in the
 *  union? `driver` and `salesperson` are not, and never will be again. A current name is
 *  a local choice that costs one grep; a renamed name is a silent empty dropdown.
 *
 *  ARIA `role="alert"` is not this at all — it is the HTML attribute — so the pattern
 *  rejects the known ARIA values rather than matching all of them. */
const ROOT = join(__dirname, "..");
const EXEMPT = new Set(["lib/roles.ts", "lib/db.ts"]);
/** lib/database/ is lib/db.ts's boot code (migrations that rename the retired roles must name
 *  them), so it is exempt for the same reason lib/db.ts is. */
const isExempt = (file: string) => EXEMPT.has(file) || file.startsWith("lib/database/");

/** The HTML/ARIA role attribute values this repo uses. */
const ARIA_ROLES = new Set([
  "alert", "alertdialog", "button", "columnheader", "combobox", "dialog", "grid", "gridcell", "group", "img",
  "listbox", "menu", "menuitem", "meter", "option", "progressbar", "radio",
  "radiogroup", "region", "status", "switch", "tab", "tablist", "toolbar", "tooltip",
]);

function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (r: string) => {
    for (const e of readdirSync(join(ROOT, r), { withFileTypes: true })) {
      const child = `${r}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

/** Strips block and line comments, so a file's own explanation of the rule is not read
 *  as a violation of it. Every fix in this repo names the stale predicate in its comment,
 *  and a test that forbids a string should not forbid the sentence explaining why. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

const PATTERNS = [
  /\brole\s*={1,2}\s*["']([a-z_]+)["']/g,
  /\brole\s+IN\s*\(\s*["']([a-z_]+)["']/g,
];

/** Role names a query spells out, ignoring ARIA attributes. */
/* `run_facility_stops.role` is a DIFFERENT vocabulary that happens to share a column name:
 * `load` and `unload` are the two halves of a run (load first, unload whenever the driver
 * chooses). They are not ROLES, they are not in the union, and they match nothing in
 * user_roles — which is the whole point of this test. Without this the pattern cannot tell
 * "a query naming a role that no longer exists" from "a query naming which end of a run it
 * is", and the honest fix is to say so rather than to spell `load` wrongly. */
const FACILITY_STOP_ROLES = new Set(["load", "unload"]);

function spelled(src: string): { value: string; at: string }[] {
  const out: { value: string; at: string }[] = [];
  for (const p of PATTERNS) {
    for (const m of src.matchAll(p)) {
      if (ARIA_ROLES.has(m[1])) continue;
      if (FACILITY_STOP_ROLES.has(m[1])) continue;
      out.push({ value: m[1], at: m[0] });
    }
  }
  return out;
}

describe("no query names a role that no longer exists", () => {
  const targets = [...filesUnder("app"), ...filesUnder("components"), ...filesUnder("lib")]
    .filter((f) => !isExempt(f));

  it("finds files to scan (guards the walker itself)", () => {
    expect(targets.length).toBeGreaterThan(50);
  });

  it("no code spells a role that is not in the union", () => {
    const live = new Set<string>(ROLES);
    const offenders: string[] = [];
    for (const file of targets) {
      for (const h of spelled(code(readFileSync(join(ROOT, file), "utf8")))) {
        if (live.has(h.value)) continue; // a current name: a local choice, costs one grep
        offenders.push(`${file}: ${h.at}  ('${h.value}' is not a Role)`);
      }
    }
    expect(
      offenders,
      `a query names a role that does not exist, so it matches nobody:\n${offenders.join("\n")}\n` +
        `Use the live name, or the VAN_ROLES/MANAGE_ROLES set from lib/roles.ts.`,
    ).toEqual([]);
  });

  it("the scan is not vacuous — it can still fail", () => {
    /* A guard that cannot fail is worse than no guard: it reports success precisely
       where it is needed. Prove it matches the two bugs it was written for. */
    const live = new Set<string>(ROLES);
    const stale = (s: string) => spelled(s).filter((h) => !live.has(h.value)).length;
    expect(stale("WHERE role = 'driver'"), "the driver bug").toBeGreaterThan(0);
    expect(stale("WHERE role = 'salesperson'"), "the salesperson bug").toBeGreaterThan(0);
    expect(stale("WHERE role = 'delivery_driver'"), "a current name is allowed").toBe(0);
  });

  it("does not mistake an ARIA attribute for a role", () => {
    for (const aria of ARIA_ROLES) {
      expect(spelled(`<p role="${aria}">x</p>`), aria).toHaveLength(0);
    }
  });

  it("knows every role it is protecting, from the one list", () => {
    expect(ROLES.length).toBeGreaterThanOrEqual(7);
    // The two names the migrations retired. Named so a future migration that retires
    // another one has to update this list, rather than leaving the guard blind to it.
    expect(ROLES).not.toContain("driver" as never);
    expect(ROLES).not.toContain("salesperson" as never);
  });
});
