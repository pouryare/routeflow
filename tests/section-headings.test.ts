import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : rel.endsWith(".tsx") ? [rel] : [];
  });
}

/** Headings that are NOT a section of a page, and so are not SectionHead's job: the
 *  title bar of a dialog or a floating panel, where the heading shares a row with a close
 *  button and is sized to the panel. Each entry is a file, with the reason. */
const NOT_SECTIONS: Record<string, string> = {
  "components/LayersPanel.tsx": "map layers floating panel",
  "components/CustomerDetailPanel.tsx": "map customer inspector title",
  "components/driver/DriverRun.tsx": "receipt dialog title",
  "components/charts/ChartFrame.tsx": "a chart's own caption, sized to the chart",
};

/** Item 15, as a class. Two adjacent sections with different headings is what the user
 *  saw once; a sweep found thirty-odd hand-rolled headings in five sizes and three
 *  weights. Every section heading goes through components/meridian/SectionHead (or a
 *  card's `.bhead`), so a hand-styled one fails here with its file and line. */
describe("section headings are one component", () => {
  it("no page or component hand-styles an h2/h3", () => {
    const offenders: string[] = [];
    for (const f of [...walk("app"), ...walk("components")]) {
      if (NOT_SECTIONS[f]) continue;
      const src = read(f);
      for (const m of src.matchAll(/<h([23])\b([^>]*)>/g)) {
        if (/className=/.test(m[2]) && !/sechead__title|phc__title/.test(m[2])) {
          offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}  <h${m[1]}${m[2].slice(0, 60)}`);
        }
      }
    }
    expect(offenders, `use <SectionHead> instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every exemption still exists and still has a heading, so the list cannot rot", () => {
    for (const f of Object.keys(NOT_SECTIONS)) expect(read(f)).toMatch(/<h[23]\b/);
  });

  it("a section heading and a card heading share one rule", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.meridian \.bhead h2,\s*\n?\s*\.meridian \.sechead__title \{/);
  });
});
