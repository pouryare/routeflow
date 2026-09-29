import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The seed data files must exist, be complete, and be TRACKED before any seed runs.
 *
 *  scripts/seed-districts.ts:58 died with ENOENT for the whole life of this repo, and the
 *  reason was worse than a missing file: the path it read,
 *  data/tehran-districts-src/districts.json, is in .gitignore as a "raw cloned source repo
 *  used only to generate mahalle.geojson once" -- so it could never have held a committed
 *  file, and a fresh clone could not have run the seeder at all. It died before line 67, so
 *  the 369 mahalle never loaded either. districts sat empty and nothing said why.
 *
 *  So this asserts three things: the files are there, they are the right size, and git
 *  actually tracks them. A source that is present-but-ignored is the exact failure that
 *  cost this repo its geography, and `fs.existsSync` alone would not catch it. */
const DATA = (f: string) => path.join(process.cwd(), "data", f);

describe("district seed sources", () => {
  it("has the 22 mantaghe file seed-districts.ts reads", () => {
    const p = DATA("tehran-districts.json");
    expect(fs.existsSync(p), `${p} is missing -- seed-districts.ts:58 will throw ENOENT`).toBe(true);
    const gj = JSON.parse(fs.readFileSync(p, "utf8")) as { type: string; features: unknown[] };
    expect(gj.type).toBe("FeatureCollection");
    expect(gj.features.length).toBe(22);
  });

  // The tripwire for the failure above. existsSync would have passed for a file dropped
  // into a gitignored directory, and the next clone would be empty again.
  it("git actually tracks every seed source", () => {
    let tracked: string;
    try {
      tracked = execSync("git ls-files data/", { cwd: process.cwd(), encoding: "utf8" });
    } catch {
      // Not a git checkout (a tarball, a test sandbox): nothing to assert.
      return;
    }
    for (const f of ["tehran-districts.json", "mahalle.geojson", "bakhsh-districts.json", "outer-towns.json"]) {
      expect(tracked, `data/${f} is not tracked -- a fresh clone cannot seed from it`).toContain(f);
    }
  });

  it("has the 369 mahalle, each naming its mantaghe", () => {
    const m = JSON.parse(fs.readFileSync(DATA("mahalle.geojson"), "utf8")) as {
      features: { properties: { name?: string; mantaghe?: string } }[];
    };
    expect(m.features.length).toBeGreaterThanOrEqual(369);
    const named = m.features.filter((f) => f.properties.name && f.properties.mantaghe);
    expect(named.length, "every mahalle needs a name and a parent").toBe(m.features.length);
  });

  it("has the 34 bakhsh and the 7 outer towns", () => {
    expect((JSON.parse(fs.readFileSync(DATA("bakhsh-districts.json"), "utf8")) as unknown[]).length).toBe(34);
    expect((JSON.parse(fs.readFileSync(DATA("outer-towns.json"), "utf8")) as unknown[]).length).toBe(7);
  });

  it("gives bomehen, abali and rudehen the Rey county they are actually in", () => {
    // They are all in شهرستان ری -- bomehen in بخش بومهن, the other two in بخش رودهن --
    // and the script filed every town under دماوند, roughly 40km away. Checked by casting
    // each centroid against the bakhsh polygons.
    const src = fs.readFileSync(path.join(process.cwd(), "scripts", "seed-outer-towns.ts"), "utf8");
    for (const town of ["بومهن", "آبعلی", "رودهن"]) {
      expect(src, `${town} must be parented to شهرستان ری`).toMatch(
        new RegExp(`${town}:\\s*"شهرستان ری"`)
      );
    }
    expect(src).toMatch(/پردیس:\s*"شهرستان پردیس"/);
  });

  // The landmine. All three scripts say "safe to re-run: INSERT OR IGNORE", and in SQLite
  // a NULL never equals another NULL inside a UNIQUE index -- so a NULL parent_name makes
  // OR IGNORE insert a fresh copy every run. Measured on the real statement: 1, 2, 3 rows.
  it("no seed passes a literal NULL parent_name", () => {
    for (const f of ["seed-districts.ts", "seed-bakhsh.ts", "seed-outer-towns.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", f), "utf8");
      // addFeature(name, level, NULL, ...) in the JS calls
      expect(src, `${f} passes NULL as a parent to addFeature`).not.toMatch(/addFeature\(\s*[^,]+,\s*"[^"]+",\s*null,/);
      // 'mantaghe', NULL, ? in the SQL literal
      expect(src, `${f} passes a NULL parent in its INSERT`).not.toMatch(/,\s*NULL,\s*\?/);
    }
  });
});
