import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** The rule this file exists to enforce:
 *
 *  No routing function outside lib/routing/ may DECLARE a distance function.
 *
 *  Not "should pass one" -- may not have one. An optional `distanceFn` with a silent
 *  straight-line default is the mechanism that let six sites each hold their own opinion
 *  about how far two points are. Every one of them compiled, every one of them looked
 *  correct, and `/leads` could be right on Monday while `?view=runs` was wrong on Tuesday,
 *  in the same app, behind the same button. The duplication was never three copies of a
 *  function; it was three places each allowed to answer "how far?" differently.
 *
 *  So the rule is checkable rather than remembered. This has been broken three times; a
 *  comment asking nicely did not survive the third. */

const ROOT = process.cwd();
const ROUTING = path.join(ROOT, "lib/routing");

/** Files allowed to declare one. Everything else must ask lib/routing for a distance. */
const ALLOWED = new Set(
  ["distance.ts", "orderStops.ts", "splitIntoDays.ts", "depot.ts"].map((f) =>
    path.join(ROUTING, f)
  )
);

function tsFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return tsFiles(p);
      return e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [p] : [];
    });
}

/** A declaration, not a use. `distanceFn(a, b)` is a caller and is fine; `distanceFn?: X` or
 *  `distanceFn: DistanceFn = ...` is someone taking the decision away from lib/routing. */
const DECLARES = /(^|[^.\w])distanceFn\s*[?:=]/;

describe("one routing core", () => {
  it("no routing function outside lib/routing declares a distanceFn", () => {
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of tsFiles(path.join(ROOT, root))) {
        if (ALLOWED.has(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        if (DECLARES.test(src)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lib/routing/distance.ts holds the only DistanceFn type", () => {
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of tsFiles(path.join(ROOT, root))) {
        if (ALLOWED.has(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        if (/type DistanceFn\s*=/.test(src)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is_default_origin is read in one place", () => {
    // The same class of bug. Eleven call sites each asking some form of "which place is the
    // origin?" is how the facility change would have had to land eleven times.
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of tsFiles(path.join(ROOT, root))) {
        if (file === path.join(ROUTING, "depot.ts")) continue;
        if (file === path.join(ROOT, "lib/db.ts")) continue; // the schema owns the column
        const src = fs.readFileSync(file, "utf8");
        if (src.includes("is_default_origin")) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no facility INSERT writes a fabricated 0, 0", () => {
    // Null Island. A place with no location is NULL; 0,0 is a fiction in the Gulf of
    // Guinea, and two writers were forced to write it because the column was NOT NULL.
    //
    // Deliberately narrow: it looks at facility INSERT statements only. A loose "0, 0
    // anywhere in a file that mentions facilities" rule matched `setHours(0, 0, 0, 0)`
    // and the schema's own CHECK list, which are both correct and would have made this
    // test a nuisance rather than a guard.
    const offenders: string[] = [];
    for (const root of ["lib", "app", "scripts"]) {
      const dir = path.join(ROOT, root);
      if (!fs.existsSync(dir)) continue;
      for (const file of tsFiles(dir)) {
        const src = fs.readFileSync(file, "utf8");
        // A VALUES tuple for a facilities insert, holding a literal 0 where a lat goes.
        for (const m of src.matchAll(
          /INSERT INTO facilities[\s\S]{0,400}?VALUES\s*\(([^)]*)\)/gi
        )) {
          if (/,\s*0\s*,\s*0\s*,/.test(m[1]) || /\b0\s*,\s*0\s*,/.test(m[1])) {
            offenders.push(path.relative(ROOT, file));
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});