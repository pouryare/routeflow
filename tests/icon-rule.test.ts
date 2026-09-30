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
 *  gap in `scripts/audit-copy.mjs`, but this file is about ICONS, and including it would make
 *  an icon test fail on Persian holiday copy — which is Plan D's business.
 *
 *  The `/g` flag is REQUIRED: `String.matchAll` throws on a non-global regex, and a test that
 *  throws reports nothing at all rather than failing honestly. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

/** Comments are stripped before the emoji scan: a comment explaining WHY emoji are banned
 *  must be able to name one. */
function stripComments(line: string): string {
  return line.replace(/\/\*.*?\*\//g, "").replace(/^\s*\/\/.*$/, "");
}

/** Blank out a whole block comment WITHOUT removing its lines.
 *
 *  Blanking rather than deleting is what keeps every reported line number true to the file
 *  on disk — deleting shifted everything below and made the report blame a <div> for an arrow
 *  five lines away. And blanking must span multiple lines: ToastProvider documents the very
 *  glyphs this rule bans inside a block comment, so a per-line stripper flags the
 *  explanation as the offence. */
function blankBlockComments(src: string): string {
  const out = src.split("\n");
  let inBlock = false;
  return out
    .map((line) => {
      let l = line;
      if (inBlock) {
        const end = l.indexOf("*/");
        if (end === -1) return "";
        l = l.slice(end + 2);
        inBlock = false;
      }
      const start = l.indexOf("/*");
      if (start !== -1) {
        const end = l.indexOf("*/", start + 2);
        if (end === -1) {
          inBlock = true;
          return l.slice(0, start);
        }
        l = l.slice(0, start) + " " + l.slice(end + 2);
      }
      return l.replace(/^\s*\/\/.*$/, "");
    })
    .join("\n");
}

/** An arrow inside a Persian sentence is PROSE, not an icon.
 *
 *  «بازگشت به نقشه ←» reads to a person and is meant to. The thing this rule bans is a glyph
 *  standing in for a control — a bare ↵ filling a button, a 📦 where an `<Icon>` should be.
 *  So a match only counts when it sits in JSX text or a bare expression with nothing around
 *  it, which is exactly the shape a hand-typed glyph takes in a control.
 *
 *  Getting this wrong in the strict direction would force 12 perfectly good Persian strings
 *  through a rewrite to satisfy a rule about icons. */
function isIconish(line: string, col: number, nextLine = ""): boolean {
  const before = line.slice(0, col);
  const after = line.slice(col + 1);
  const next = after[0];
  const prev = before.slice(-1);

  const isWordish = (c: string | undefined) =>
    c !== undefined && /[\p{Script=Arabic}\p{L}\p{N}]/u.test(c);

  // A glyph glued to a word on either side is part of a sentence: «همه سفارش‌ها ←».
  if (isWordish(next)) return false;
  if (isWordish(prev)) return false;

  // Persian prose puts a SPACE before its arrows. A glyph with no space on its left is
  // standing in for a control — `>↵<`, `{↵}`, and the SearchBox case — which is exactly
  // what this rule bans. One space on the left is enough to make it a sentence character,
  // whether or not a space follows it: `بازگشت به نقشه ←</Link>` has `<` on the right and
  // is still prose.
  if (prev === " ") return false;
  // A line that is nothing but the glyph is the most obviously a control of all.
  if (line.trim() === "→" || line.trim() === "↵") return true;

  // A trailing glyph at end of line: prose when the sentence simply ends there, a control
  // only if the next line opens with a word continuing the same thought.
  if (next === undefined) {
    const continuation = nextLine.trimStart()[0];
    return continuation !== undefined && isWordish(continuation);
  }

  return true;
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
      const raw = read(f);
      // Comments are BLANKED in place, never deleted: deleting them shifts every following
      // line, which made the report blame a <div> for an arrow five lines below it. A wrong
      // bug report is worse than no report.
      const allLines = blankBlockComments(raw).split("\n");
      for (let li = 0; li < allLines.length; li += 1) {
        const line = allLines[li];
        const nextLine = allLines[li + 1] ?? "";
        for (const m of line.matchAll(EMOJI)) {
          if (!isIconish(line, m.index ?? 0, nextLine)) continue;
          offenders.push(`${f}:${li + 1}  ${JSON.stringify(m[0])}`);
        }
      }
    }
    expect(offenders, `use <Icon name="..." />:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("still catches a bare glyph used as a control, not just prose", () => {
    // The guard is only worth having if it fails on the thing it bans. This is the shape
    // SearchBox had: a lone ↵ as a button's entire content. The index is computed with
    // indexOf rather than written down, because a hand-counted offset into a string
    // containing a multi-unit glyph is a test that fails for the wrong reason.
    const control = '><button type="button">↵</button>';
    expect(isIconish(control, control.indexOf("↵"), "<span>x</span>")).toBe(true);
    // A glyph flush against markup on both sides, with no word anywhere near it.
expect(isIconish("→", 0)).toBe(true);
expect(isIconish('<Icon/>→', 6)).toBe(true);
    // …and must NOT fire on a Persian sentence that happens to end in an arrow.
    const prose = "بازگشت به نقشه ←";
    expect(isIconish(prose, prose.indexOf("←"), "</Link>")).toBe(false);
    expect(isIconish(prose, prose.indexOf("←"), "  ادامهٔ جمله")).toBe(false);
    // The real-world case this whole helper exists for, verbatim from
    // app/(shell)/leads/page.tsx: a prose arrow whose right-hand neighbour is `</Link>`.
    const leadsLine =
      '<Link href="/map" className="x">بازگشت به نقشه ←</Link>';
    expect(isIconish(leadsLine, leadsLine.indexOf("←"), "</div>")).toBe(false);
    const log = 'setLog(`«x» → ${label}`);';
    expect(isIconish(log, log.indexOf("→"))).toBe(false);
  });

  it("MASTER.md names Lucide as the one library", () => {
    expect(read("MASTER.md")).toMatch(/##\s*Icons?\b[\s\S]*?[Ll]ucide/);
  });

  it("MASTER.md no longer excludes Lucide", () => {
    expect(read("MASTER.md")).not.toMatch(/[Ll]ucide[^.\n]{0,80}excluded/i);
  });
});
