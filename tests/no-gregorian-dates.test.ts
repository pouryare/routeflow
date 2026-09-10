import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every date a Persian reader sees is Jalali.
 *
 *  `faDateTime` and `faDate` in lib/format.ts print the GREGORIAN year, month and day
 *  through faDigits. The result looks Persian — «۲۰۲۶/۰۹/۱۰» — and is about 621 years
 *  wrong. Nothing at the call site reveals that: the function name starts with "fa", the
 *  output is in Persian digits, and it reads as correct at a glance and in review.
 *  Sixteen call sites across twelve files survived until a user read a batch expiry date.
 *
 *  So the check sits at the import, which is the one place the mistake is unambiguous.
 *  `lib/` may still use them — a filename, a CSV column, anything not read as a date by a
 *  human — but nothing rendered may.
 */
const ROOT = join(__dirname, "..");

/** Matches a named import of faDate or faDateTime from lib/format, in any position of the
 *  braces and regardless of what else is imported alongside. */
const GREGORIAN = /import\s*\{[^}]*\bfaDate(?:Time)?\b[^}]*\}\s*from\s*["']@\/lib\/format["']/;

function renderedFiles(): string[] {
  // Directory pathspecs, then filter by extension.
  //
  // Deliberately NOT a recursive-glob pathspec: git's `**` requires at least one
  // intervening directory, so a components-slash-star-star pattern silently skips every
  // file sitting directly in components/ — which is where CustomerDetailPanel,
  // DataFreshness and HistoryTimeline live. The first draft of this test did exactly
  // that and reported 10 offenders out of 12. A ratchet that quietly checks two thirds
  // of the tree is worse than none, because it reports success.
  return execFileSync("git", ["ls-files", "app", "components"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".tsx"));
}

describe("no Gregorian dates in rendered output", () => {
  it("no file under app/ or components/ imports faDate or faDateTime", () => {
    const offenders = renderedFiles().filter((f) =>
      GREGORIAN.test(readFileSync(join(ROOT, f), "utf8")),
    );
    expect(
      offenders,
      `use faJalaliDate (for a *_date column) or faJalaliDateTime (for a *_at timestamp) from @/lib/jalali:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the Jalali helpers this rule depends on still exist", () => {
    /* If someone renames these, the rule above silently becomes unenforceable — every
       file passes because nobody can import the thing it is steering them towards. */
    const jalali = readFileSync(join(ROOT, "lib", "jalali.ts"), "utf8");
    expect(jalali).toMatch(/export function faJalaliDate\b/);
    expect(jalali).toMatch(/export function faJalaliDateTime\b/);
  });
});
