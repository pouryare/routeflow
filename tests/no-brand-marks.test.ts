import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? files(rel, ext) : ext.test(e.name) ? [rel] : [];
  });
}

/** Item 1 asked for the logo to go; item 28 asked for «the rectangle with ن on it … and
 *  other instances looking like that» to go. Slice H fixed the one in the map sidebar and
 *  slice I removed the header's. Two more survived: the map sidebar's brand row (a mark
 *  plus a wordmark duplicating the page title) and the map's loading splash, which still
 *  drew the gradient tile with «ن» on it. So the rule is on the class of thing:
 *  no brand-mark classes anywhere, and no element whose entire content is one Persian
 *  letter, which is how a monogram tile is written. */
describe("no logo marks left from the old theme", () => {
  const tsx = [...files("app", /\.tsx$/), ...files("components", /\.tsx$/)];

  it("no component renders a brand mark or brand row", () => {
    const offenders = tsx.filter((f) => /\b(side__mark|side__brand|brandwrap)\b/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the stylesheet no longer styles one", () => {
    expect(readFileSync(join(ROOT, "app/globals.css"), "utf8")).not.toMatch(/\.side__mark|\.side__brand|\.brandwrap/);
  });

  it("no element is a lone Persian letter standing in for a logo", () => {
    const offenders: string[] = [];
    for (const f of tsx) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const m of src.matchAll(/>\s*([؀-ۿ])\s*</g)) {
        /* A font specimen is not a logo: FontPicker shows the chosen font by setting one
           letter in it, and a specimen always names its font inline. */
        const tag = src.slice(src.lastIndexOf("<", m.index), m.index);
        if (/fontFamily/.test(tag)) continue;
        offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}  «${m[1]}»`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
