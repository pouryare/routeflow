import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A context's DEFAULT value must not be mistakable for real data.
 *
 *  `useContext` on an unprovided context does not throw — it hands back the default. So a
 *  missing provider is indistinguishable from a working one, and the failure is silent by
 *  construction. MyPositionProvider's default was `{ position: null, status: "idle",
 *  error: null, retry: () => {} }`: /driver lives in app/(bare), which mounted no
 *  provider, so VerifyVisits recorded every visit with pos = null and a next-stop banner
 *  showed no distance — on a page that rendered perfectly and lied.
 *
 *  The rule: a default may not carry a field whose value is the ordinary empty result of a
 *  real one. `position: null` and `items: []` and `data: null` are what a LOADED context
 *  looks like when there is genuinely nothing. If the default says that, a missing
 *  provider and an empty day look the same.
 *
 *  The test is a source scan rather than a runtime one, because the failure mode has no
 *  exception to catch and no render to inspect. */
const ROOT = join(__dirname, "..");

function filesUnder(rel: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (r: string) => {
    for (const e of readdirSync(join(ROOT, r), { withFileTypes: true })) {
      const child = `${r}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

/** Strips comments, so a file explaining the rule is not read as breaking it. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

describe("context defaults cannot be mistaken for real data", () => {
  const sources = filesUnder("components", [".tsx", ".ts"]);

  it("finds the provider files at all (guards the walker itself)", () => {
    expect(sources.some((f) => f.includes("Provider"))).toBe(true);
  });

  it("no context default is a plausible real state with nothing marking it as one", () => {
    /* The rule has two halves, and the second is what makes the first usable.
     *
     * A default that says `position: null` is indistinguishable from a loaded context
     * with nothing to report — unless the default also says, in its own body, that it is
     * not a real value. A `throw` is that statement: a missing provider reached through
     * this default says so in as many words rather than handing back plausible nothing.
     *
     * So: a default may carry a plausible field ONLY IF its own body contains a marker
     * that names the absence. `MyPositionProvider` now does, via a `retry` that throws
     * with the fix in the message. A default with neither is the bug: silently fine.
     */
    const plausible = /\b(position|data|items|rows|value|result)\s*:\s*(null|\[\])/;
    const marks_absence = /\bthrow\b/;
    const offenders: string[] = [];

    for (const file of sources) {
      const src = code(readFileSync(join(ROOT, file), "utf8"));
      for (const m of src.matchAll(/createContext<[^>]*>\(\s*\{([\s\S]{0,400}?)\}\s*[,)]/g)) {
        const literal = m[1];
        if (!plausible.test(literal)) continue;
        if (marks_absence.test(literal)) continue; // it says what it is
        offenders.push(`${file}: ${literal.trim().slice(0, 80)}`);
      }
    }

    expect(
      offenders,
      `a context default that reads as real data AND does not say so — a missing provider\n` +
        `then looks exactly like an empty one, with nothing to tell them apart:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the scan is not vacuous — it can still fail", () => {
    /* A guard that cannot fail is worse than no guard: it reports success precisely
       where it is needed. Prove the pattern still matches the shape it was written for,
       and that the marker is what earns the exemption. */
    const plausible = /\b(position|data|items|rows|value|result)\s*:\s*(null|\[\])/;
    const marks_absence = /\bthrow\b/;

    // The bug as it shipped: plausible, silent, red.
    expect(plausible.test('position: null, status: "idle"') && !marks_absence.test('position: null, status: "idle"')).toBe(true);
    // The fix: still carries position, but says what it is.
    const fixed = 'position: null, status: "idle", retry: () => { throw new Error("no provider") }';
    expect(plausible.test(fixed) && marks_absence.test(fixed)).toBe(true);
    // A default that is obviously not-a-state needs no marker.
    expect(plausible.test('status: "unprovided"')).toBe(false);
  });
});
