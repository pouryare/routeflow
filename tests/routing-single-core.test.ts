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

/** Everything IN lib/routing may declare one -- that is the module's whole job. Everything
 *  outside it must ask. Read from the directory rather than listed by hand, so adding a
 *  routing module does not mean editing this file and forgetting. */
const ALLOWED = new Set(
  fs
    .readdirSync(ROUTING)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(ROUTING, f))
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

/** The actual disease, stated precisely.
 *
 *  A module outside lib/routing may ACCEPT a distance, so long as it is typed `DistanceFn`
 *  and forwarded untouched. That is a pass-through: the caller chose, and the module is not
 *  claiming authority it does not have. clusterDays and dayCapacity do exactly this.
 *
 *  What it may not do is write the distance type out by hand -- `(a: LatLng, b: LatLng) =>
 *  number` -- because that is a module declaring itself a second, structurally identical
 *  source of distance truth. Nor may it supply a default of its own, which is how one of the
 *  six sites came to measure in degrees while ignoring the function it was handed.
 *
 *  Three earlier versions of this regex each failed on a file nobody had touched, which is
 *  how the rule got its current shape:
 *    - `[?:=]` matched the first `?` of `distanceFn ?? straightLine`.
 *    - a bare `:` matched `const distanceFn = fromMatrix(...)` -- a local binding, and
 *      exactly what a caller is supposed to write.
 *    - flagging every `distanceFn?:` flagged the pass-throughs too, i.e. the rule read as
 *      "you may not forward a distance", which was not what was wrong. */
const INLINE_FN_TYPE = /distanceFn\s*\??:\s*\(\s*a\s*:\s*LatLng/;
const OWN_DEFAULT = /distanceFn\s*(?:\?\s*)?=\s*(?!straightLine\b)/;
/** `const distanceFn = fromMatrix(...)` is a CALLER building one to hand to lib/routing --
 *  the exact thing we want callers to do -- so a local binding of that name is not a
 *  declaration of anything. */
const LOCAL_BINDING = /\b(?:const|let)\s+distanceFn\b/;

describe("one routing core", () => {
  it("no module outside lib/routing declares its own distance", () => {
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of tsFiles(path.join(ROOT, root))) {
        if (ALLOWED.has(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        // Line-wise so a local binding can be excluded without letting one legitimate
        // `const` elsewhere in the file excuse an inline function type on another line.
        const declaresOwn = src
          .split("\n")
          .some((l) => !LOCAL_BINDING.test(l) && (INLINE_FN_TYPE.test(l) || OWN_DEFAULT.test(l)));
        if (declaresOwn) offenders.push(path.relative(ROOT, file));
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

  it("only lib/routing and lib/db decide where the origin is", () => {
    /* The same class of bug as the distance one. Two readers of this question already
       disagreed -- distances fell through flag -> home base -> first, stock went
       kind='warehouse' -> flag -> lowest id -- so a business whose depot was not typed
       "warehouse" could never load a van.

       Narrow on purpose, twice over. Naming the column is not deciding anything: the API
       routes write it, the sites page renders a checkbox for it, every INSERT lists it, and
       readFacilities projects it into the row shape. Only a SELECT that ORDERS or filters by
       it is answering "which place is the origin".

       The `[^;]*` stops the match running past the end of one statement into the next, which
       is how a plain `SELECT *` came to look like a decision. */
    const DECIDES = /SELECT[^;]*is_default_origin[^;]*(ORDER BY|AND|WHERE)|ORDER BY[^;]*is_default_origin/;
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of tsFiles(path.join(ROOT, root))) {
        if (file === path.join(ROUTING, "depot.ts")) continue;
        if (file === path.join(ROOT, "lib/db.ts")) continue; // the schema owns the column
        if (DECIDES.test(fs.readFileSync(file, "utf8"))) offenders.push(path.relative(ROOT, file));
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