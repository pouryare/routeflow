import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const auditSrc = readFileSync(path.join(root, "scripts", "audit-copy.mjs"), "utf8");

/** Run the script's real detector instead of re-implementing it.
 *
 *  The plan's test asserted only that the string "FE70" appears somewhere in the file,
 *  which a comment would satisfy. That is a test that cannot fail usefully: it proves a
 *  word was typed, not that the rule works. So the function is lifted out of the source
 *  and *executed* against the cases that matter — including the five clean Persian strings
 *  that must NOT match, which is the half a one-sided test never checks. */
function loadDetectArabicChars(): (str: string) => { status: string; note: string } | null {
  const start = auditSrc.indexOf("function detectArabicChars");
  if (start === -1) throw new Error("detectArabicChars not found in scripts/audit-copy.mjs");
  // Take the whole function body, whatever it is now — braces balanced by depth count.
  let depth = 0;
  let i = auditSrc.indexOf("{", start);
  const open = i;
  for (; i < auditSrc.length; i++) {
    if (auditSrc[i] === "{") depth++;
    else if (auditSrc[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const src = auditSrc.slice(start, i + 1);
  // eslint-disable-next-line no-new-func -- executing the script's own source on purpose
  return new Function(`return (${src})`)() as (str: string) => { status: string; note: string } | null;
}

const detect = loadDetectArabicChars();

const ARABIC = (codePoint: number) => String.fromCodePoint(codePoint);

/** "Eid al-Fitr" as Persian, written in the ARABIC PRESENTATION FORMS block.
 *
 *  Renders correctly, contains zero Persian codepoints, and is invisible to a human
 *  reviewing a rendered page. This is exactly how the Iranian holiday dataset arrives.
 *
 *  Built from CODEPOINTS, never typed by hand. An earlier hand-typed literal looked
 *  plausible and was wrong, which sent me chasing a phantom "NFKC produces Arabic yeh"
 *  bug — the codepoint-built version below is the one the data actually contains. */
describe("the copy audit catches Arabic script, including presentation forms", () => {
  const IR_YAML = readFileSync(path.join(root, "data", "holidays", "IR.yaml"), "utf8");

  /** The Fitr name exactly as the vendored file writes it — extracted, never retyped.
   *
   *  This went wrong twice. A hand-typed "presentation forms" literal looked right on screen
   *  and held the wrong codepoints, which produced a convincing but entirely phantom
   *  "NFKC yields Arabic yeh" finding. Then a codepoint array was mistyped the same way.
   *  The lesson is that these glyphs are indistinguishable in a diff and in a terminal, so
   *  the only trustworthy source is the file itself. `normalize()` on the extracted string
   *  is what Task 2b will actually do, so the test now does exactly that. */
  const FITR_RAW = (() => {
    const line = IR_YAML.split("\n").find((l) => /ﻓﻄﺮ/.test(l));
    if (!line) throw new Error("no Eid al-Fitr line in data/holidays/IR.yaml");
    return line.trim().replace(/^fa:\s*/, "");
  })();
  const FITR_PERSIAN = "عید سعید فطر";
  // Normalise BEFORE stripping: the "به مناسبت" prefix is itself in presentation forms, so
  // a plain string replace against a typed Persian prefix silently does nothing.
  const fitrName = FITR_RAW.normalize("NFKC").replace(/^به مناسبت\s*/, "");

  it("NFKC removes every presentation codepoint", () => {
    // Every presentation codepoint is gone after one pass. This is what lets Task 2b
    // normalise the dataset mechanically instead of hand-editing 16 names.
    expect(/[ﺀ-ﻼ]/u.test(FITR_RAW)).toBe(true);
    expect(/[ﺀ-ﻼ]/u.test(FITR_RAW.normalize("NFKC"))).toBe(false);
  });

  it("NFKC turns the presentation copy into exactly the Persian string", () => {
    // The plan's claim, verified against the real file rather than a sample I typed. 178
    // presentation codepoints; after NFKC every yeh is PERSIAN (U+06CC) and none is Arabic
    // (U+0649). So one .normalize() call really does make all 16 names importable, and
    // Task 2b must NOT hand-edit them.
    expect(fitrName.normalize("NFKC")).toBe(FITR_PERSIAN);
  });

  it("normalisation is idempotent, so a second pass changes nothing", () => {
    const once = fitrName.normalize("NFKC");
    expect(once.normalize("NFKC")).toBe(once);
  });

  it("FLAGS the presentation-forms block — this is the gap being closed", () => {
    // The RAW string, presentation glyphs and all. This is the assertion that fails before
    // the detector is widened and passes after — the actual RED of this task.
    expect(/[ﺀ-ﻼ]/u.test(FITR_RAW)).toBe(true);
    expect(detect(FITR_RAW)?.status).toBe("ARABIC-CHAR");
    // And the normalised form must be clean, or widening the rule would flag the app's own
    // imported holiday names.
    expect(detect(fitrName)).toBeNull();
  });

  it("still flags the four original Arabic letters", () => {
    // The rule that existed before. Widening must not quietly drop any of these — a first
    // draft of this class lost U+064A and let Arabic Yeh straight through.
    for (const [label, ch] of [
      ["ARABIC YEH", ARABIC(0x0649)],
      ["ARABIC KAF", ARABIC(0x0643)],
      ["ARABIC YEH (alt)", ARABIC(0x064a)],
      ["ARABIC TEH MARBUTA", ARABIC(0x0629)],
    ] as const) {
      expect(detect(`متن ${ch}`)?.status, `${label} was let through`).toBe("ARABIC-CHAR");
    }
  });

  it("flags Arabic diacritics", () => {
    expect(detect(`مُحَمَّد`)?.status).toBe("ARABIC-CHAR");
  });

  it("does NOT flag clean Persian — the half a one-sided test never checks", () => {
    // Five real strings this app actually uses. If the range were widened carelessly these
    // would start failing and the obvious "fix" would be to weaken the rule.
    for (const s of [
      "عید سعید فطر",
      "نوروز",
      "قیام ۱۵ خرداد",
      "روز جمهوری اسلامی",
      "سیزده بدر",
      "ولادت حضرت رسول اکرم",
      "ی ک",
    ]) {
      expect(detect(s), `false positive on ${JSON.stringify(s)}`).toBeNull();
    }
  });

  it("the vendored dataset folds to clean Persian, measured on the real file", () => {
    // The whole reason this task exists. Read the ACTUAL vendored file rather than a
    // hard-coded sample, and MEASURE rather than eyeball. These three numbers are what
    // proved the plan's NFKC claim right and my hand-typed sample wrong.
    const yaml = IR_YAML;
    const folded = yaml.normalize("NFKC");
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

    // 178 presentation forms go in; none survive. If a dataset revision adds a codepoint
    // NFKC cannot fold, this is the assertion that says so.
    expect(count(yaml, /[ﺀ-ﻼ]/gu), "expected presentation forms in the vendored file")
      .toBeGreaterThan(0);
    expect(count(folded, /[ﺀ-ﻼ]/gu)).toBe(0);

    // Every yeh becomes PERSIAN (U+06CC), never Arabic (U+0649). The count RISING is the
    // proof: 21 Persian yehs are already there, and folding the presentation forms doubles
    // it to 42. Had any of them landed on U+0649 the importer would write Arabic into the
    // database and the widened audit would flag its own output.
    expect(count(yaml, /ى/gu), "dataset should contain no Arabic yeh to begin with").toBe(0);
    expect(count(folded, /ى/gu), "NFKC must not introduce Arabic yeh").toBe(0);
    expect(count(folded, /ی/gu)).toBeGreaterThan(count(yaml, /ی/gu));

    // And the normalised file is what the importer will actually write. The ONLY thing still
    // flagged is U+0651 SHADDA in «صلّی الله علیه» — a legitimate Arabic diacritic inside a
    // transliterated religious phrase, in exactly 2 of the 28 lines. That is the diacritics
    // range doing its job on text that genuinely is Arabic, so the fix belongs in the
    // IMPORTER (strip or keep it deliberately), not in weakening the audit: a Persian
    // sentence carrying stray tashkeel is a real defect, and the range is what catches it.
    expect(folded).toContain(FITR_PERSIAN);
    expect(detect(folded), "presentation forms should all be gone after NFKC").toEqual(
      expect.objectContaining({ status: "ARABIC-CHAR" }),
    );

    // Strip the diacritics the way the importer must. That removes the shadda, but it does
    // NOT make the dataset clean -- and that is the most useful finding in this file.
    const imported = folded.replace(/[\u064B-\u0652\u0670\u0640]/g, "");

    // Two lines still fail, for two DIFFERENT and legitimate reasons:
    //
    //  1. U+0651 SHADDA in «صلى الله عليه» -- genuine Arabic tashkeel in a transliterated
    //     religious phrase. Correct to strip at import.
    //  2. U+0643 ARABIC KAF in «عسکرى» on the Imam Hasan line -- a REAL copy defect.
    //     Persian spells عسكرى with ک (U+06A9); the dataset ships the Arabic ك. This is
    //     precisely the class of mistake this audit exists to catch, and it survives NFKC
    //     because it is a genuine Arabic letter, not a presentation form.
    const stillBad = imported.split("\n").filter((l) => detect(l));
    expect(stillBad, "expected only the kaf defect to survive diacritic stripping").toHaveLength(1);
    expect(stillBad[0]).toContain("\u0639\u0633\u0643\u0631\u06CC");
    expect(detect(stillBad[0])?.status).toBe("ARABIC-CHAR");

    // Fix that one letter the way the importer must, and the dataset is finally clean.
    const fixed = imported.replace(/\u0643/g, "\u06A9");
    expect(detect(fixed), "dataset still flagged after the kaf fix").toBeNull();
    expect(fixed).toContain(FITR_PERSIAN);
  });
});