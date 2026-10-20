import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One word per thing, in every string a reader sees.
 *
 *  The app said «ویزیت» on the schedule and «بازدید» everywhere else, «لیست» on the leads
 *  page and «فهرست» in the page overviews, and «بچ» for what Iranian packaging prints as
 *  «سری ساخت». Two words for one thing reads as two things. «پاکت» and «داشبورد» named
 *  pages after nothing on them; they are «کارهای من» and «خلاصهٔ فروش» now.
 *
 *  Comments are stripped before matching: the rule is about copy, not about prose written
 *  for the next developer. lib/repo/retiredWording.ts is exempt because it has to spell the old
 *  text to find it in stored rows.
 */
const ROOT = join(__dirname, "..");
const EXEMPT = new Set(["lib/repo/retiredWording.ts"]);

const RETIRED: { word: RegExp; use: string }[] = [
  { word: /ویزیت/, use: "بازدید" },
  { word: /لیست/, use: "فهرست" },
  // «بچه» (a packaging size) and «بچسبانید» are other words; «بچ‌ها» and «بچی» are this one.
  { word: /(?<![؀-ۿ])بچ(?![هس])/, use: "سری ساخت" },
  { word: /داشبورد/, use: "خلاصهٔ فروش" },
  { word: /پاکت/, use: "کارهای من" },
  // Added with the copy audit (docs/copy-audit/ux-copy-audit.md): one word per thing.
  { word: /جست\u200cوجو/, use: "جستجو" },
  { word: /لوکیشن/, use: "مکان" },
  { word: /تایید/, use: "تأیید" },
  { word: /پیوند/, use: "لینک" },
  { word: /گوگل\u200cمپس/, use: "گوگل‌مپ" },
];

function sources(rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(child));
    else if (/\.(ts|tsx)$/.test(e.name) && !EXEMPT.has(child)) out.push(child);
  }
  return out;
}

/** Block comments, then line comments not preceded by ":" (so https:// survives). */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("vocabulary", () => {
  const files = ["app", "components", "lib"].flatMap(sources);

  it("finds the source tree (guards the walker)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  for (const { word, use } of RETIRED) {
    it(`no screen says ${word.source} — it is «${use}»`, () => {
      const hits: string[] = [];
      for (const f of files) {
        withoutComments(readFileSync(join(ROOT, f), "utf8"))
          .split("\n")
          .forEach((line, i) => {
            if (word.test(line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
          });
      }
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }

  it("the batch rule tells the other words apart", () => {
    const batch = RETIRED[2].word;
    expect(batch.test("بچ‌ها")).toBe(true);
    expect(batch.test("کد بچ")).toBe(true);
    expect(batch.test("جعبه بچه")).toBe(false);
    expect(batch.test("بچسبانید")).toBe(false);
  });
});
