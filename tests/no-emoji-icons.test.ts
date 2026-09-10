import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The app has one icon library. This test is what keeps it that way.
 *
 *  An emoji is not an icon, it is *a coloured picture from a font nobody in this repo
 *  controls*. It renders in the vendor's palette rather than the theme's — Apple draws
 *  🔔 amber, Noto draws it brown, and neither answers to `color` or to the accent the
 *  reader picked. It ignores `stroke-width`, so it sits at a different visual weight
 *  from every lucide glyph beside it. It changes shape between the reader's phone and
 *  their desktop. And it is announced by screen readers as its CLDR name in English
 *  ("bell"), in the middle of a Persian sentence.
 *
 *  One of them anywhere is enough to make the interface look assembled from parts, which
 *  is exactly the complaint that started this sweep. So: none, and a failing test rather
 *  than a convention nobody remembers.
 *
 *  Comments are exempt — this file's own prose is full of them, and so is the note in
 *  ActionCenter explaining what its emoji used to be.
 */

/* Pictographic ranges only. Deliberately NOT the whole of Misc Symbols: this repo uses
   «·», «—», «‹›» and Persian digits as typography, and they are not icons pretending to
   be something else. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

/** Strip //, /* *​/ and JSX {/* *​/} comments so prose about emoji does not fail the
 *  test that forbids them. Crude on purpose — it only has to be right about which lines
 *  are commentary, and a false "this is a comment" would need a `//` or `*` inside a
 *  string, which would still be caught by the reviewer this test is written for. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const ROOT = join(__dirname, "..");

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("tests/") && !f.startsWith("scripts/"));
}

describe("no emoji where an icon belongs", () => {
  it("every icon in app, components and lib comes from the icon vocabulary", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const body = stripComments(readFileSync(join(ROOT, f), "utf8"));
      body.split("\n").forEach((line, i) => {
        if (EMOJI.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders, `use <Icon name="…" /> instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no text glyph stands in for an icon either", () => {
    /* Not emoji, so the rule above missed them: «ⓘ» for info, «⋯» for a menu, «▾» for a
       disclosure, «▲▼» and «↑↓» for direction, «◎» for locate. They take the font's weight instead
       of the icon stroke and are read aloud as their Unicode names. Sixteen were found in
       one sweep. Typography («·», «—», «→» in a sentence) is deliberately not in the set. */
    const GLYPH = /[ⓘ⋯✓✔✕✖☰⚙★☆▲▼◀▶⌘⏱⇄↻⟳⟲✎✏⊕⊖⊗⨯◉◎▸▾▴◂♥♡✚➕➖➜➤⮕⬅⬆⬇↑↓]/u;
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const body = stripComments(readFileSync(join(ROOT, f), "utf8"));
      body.split("\n").forEach((line, i) => {
        if (GLYPH.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders, `use <Icon name="…" /> instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("feature code never imports lucide-react directly", () => {
    const offenders = sourceFiles().filter(
      (f) =>
        !f.startsWith("components/meridian/icon-map") &&
        /from ["']lucide-react["']/.test(readFileSync(join(ROOT, f), "utf8")),
    );
    expect(
      offenders,
      `add the glyph to components/meridian/icon-map.ts instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
