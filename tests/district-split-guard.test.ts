import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Add, never split.
 *
 *  customers.district_id is a plain INTEGER foreign key. scripts/split-districts.ts gives
 *  the largest piece the ORIGINAL row id and the new piece a fresh one -- and moves no
 *  customer to it. So every customer in a split محله keeps pointing at the piece that kept
 *  the id, even when they are geographically in the other half, and nothing re-derives
 *  them until someone edits that customer.
 *
 *  Before a seed it is a no-op. After one it is corruption, and the same shape as the pin
 *  fold deleting a run stop mid-run (a98ae50) and the fourth FK referrer (d523fe3).
 *
 *  This is a source-level test on purpose. The behaviour is a refusal inside a script that
 *  opens SQLite directly and mutates rows, so exercising it for real would mean seeding a
 *  customer onto a district and then splitting live data to watch it refuse. Asserting the
 *  guard is present, counts first, and is not wired into any boot is checkable without
 *  that. */
const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("a district with customers is never split", () => {
  it("counts referencing customers before it splits", () => {
    const src = read("scripts/split-districts.ts");
    expect(src, "the split must look at customers first").toMatch(/district_id/);
    expect(src, "and count them").toMatch(/COUNT\(\*\)|customersPerDistrict|customersRef/i);
  });

  it("refuses when the count is non-zero", () => {
    const src = read("scripts/split-districts.ts");
    expect(src, "a non-zero count must skip the district").toMatch(/skip/i);
    // The message must name the district and the count, so an operator who hit it can act.
    expect(src, "the skip message should carry the count").toMatch(/\$\{[^}]*count|\$\{referencing/);
  });

  it("is never invoked from a boot migration", () => {
    // A migration would run on every boot, forever, against data that grows.
    expect(read("lib/db.ts"), "splitting is a manual seed-time step").not.toMatch(/split-districts/);
    expect(read("lib/repo/rules.ts")).not.toMatch(/split-districts/);
    for (const f of ["lib/groups.ts", "lib/repo/crm/write.ts"]) {
      expect(read(f), `${f} must not split districts`).not.toMatch(/planSplit|split-districts/);
    }
  });

  it("is still available for the seed-time split, dry-run first", () => {
    const src = read("scripts/split-districts.ts");
    expect(src, "dry-run by default is what makes it safe to point at a live database").toMatch(/--apply/);
    expect(src).toMatch(/dry-run|changes nothing/i);
  });

  it("planSplit stays reachable for the seeds that legitimately split at seed time", () => {
    // Not a ban: seed-districts.ts splits 13 same-name cases while the table is empty,
    // which is the one moment splitting is free.
    expect(read("scripts/seed-districts.ts")).toMatch(/planSplit/);
  });
});
