import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return walk(rel);
    return rel.endsWith(".tsx") || rel.endsWith(".ts") ? [rel] : [];
  });
}

/** The only files allowed to name the icon library directly. Everything else goes through
 *  `components/meridian/Icon`, which keeps stroke width and pixel size from drifting apart
 *  between two buttons that mean the same thing. */
const SANCTIONED = new Set([
  path.join("components", "meridian", "icon-map.ts"),
  path.join("components", "meridian", "Icon.tsx"),
  path.join("tests", "icon-rule.test.ts"),
]);

/** Emoji in the ranges most likely to be pasted "as an icon".
 *
 *  Note what is deliberately NOT here: the Arabic Presentation Forms block. That is a real
 *  gap in `scripts/audit-copy.mjs`, but this file is about ICONS, and adding U+FE70–U+FEFF
 *  would make an icon test fail on Persian holiday copy — which is Plan D's business and is
 *  handled there. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

/** Comments are stripped before the emoji scan: a comment explaining WHY emoji are banned
 *  must be able to name one. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("one icon library, reached one way", () => {
  it("finds the files at all (guards the walker itself)", () => {
    const files = [...walk("app"), ...walk("components")];
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(path.join("components", "meridian", "Icon.tsx"));
  });

  it("no feature file imports lucide-react directly", () => {
    const offenders: string[] = [];
    for (const f of [...walk("app"), ...walk("components")]) {
      if (SANCTIONED.has(f)) continue;
      if (/from\s+["']lucide-react["']/.test(read(f))) offenders.push(f);
    }
    expect(
      offenders,
      `import { Icon } from "@/components/meridian/Icon" instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no emoji is used as an icon", () => {
    const offenders: string[] = [];
    for (const f of [...walk("app"), ...walk("components")]) {
      const src = read(f);
      for (const m of stripComments(src).matchAll(EMOJI)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${f}:${line}  ${JSON.stringify(m[0])}`);
      }
    }
    expect(offenders, `use <Icon name="..." />:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("MASTER.md names Lucide as the one library", () => {
    expect(read("MASTER.md")).toMatch(/##\s*Icons?\b[\s\S]*?[Ll]ucide/);
  });

  it("MASTER.md no longer excludes Lucide", () => {
    expect(read("MASTER.md")).not.toMatch(/[Ll]ucide[^.\n]{0,80}excluded/i);
  });
});
