import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SQL outside lib/database/ keeps to PostgreSQL's spelling.
 *
 *  Each spelling below is SQLite's, left over from before the move (Wave P): it fails or means
 *  something different in PostgreSQL. The right form is named next to it; lib/database/dialect.ts
 *  holds the helpers.
 *
 *  A comment line that mentions a spelling is prose, not SQL, and is not counted. */

const ROOT = join(__dirname, "..");

const BANNED: { re: RegExp; use: string }[] = [
  { re: /\bdate\(\s*'now'/i, use: "pass tehranTodayIso() as a parameter (date('now') is the UTC day)" },
  { re: /\bdatetime\(\s*'now'/i, use: "pass new Date().toISOString() as a parameter" },
  { re: /\bdate\(\s*(\?|\w+\.\w+\s*,)/, use: "addDays() from lib/database/dialect, or compute the date in TypeScript" },
  { re: /\bjulianday\(/i, use: "daysBetween() from lib/database/dialect" },
  { re: /\bstrftime\(/i, use: "format the date in TypeScript" },
  { re: /\bgroup_concat\(/i, use: "stringAgg() from lib/database/dialect" },
  { re: /\bINSERT\s+OR\s+(IGNORE|REPLACE)\b/i, use: "INSERT ... ON CONFLICT DO NOTHING / DO UPDATE" },
  { re: /\blast_insert_rowid\(/i, use: "the run() result's lastInsertRowid" },
  { re: /\bPRAGMA\b/, use: "nothing outside lib/database/: the schema is fixed once migrations have run" },
  { re: /\bsqlite_master\b/i, use: "nothing outside lib/database/" },
  { re: /\bIFNULL\(/i, use: "COALESCE()" },
  { re: /\bIS\s+\?/i, use: "IS NOT DISTINCT FROM ? (null-safe equality in both engines)" },
  { re: /\bROUND\(/, use: "round() from lib/database/dialect (PostgreSQL rounds a double's halves to even)" },
  { re: /\bUPDATE\s+OR\s+\w+/i, use: "a WHERE that skips the rows that would clash" },
  { re: /(includes\(|\/)(UNIQUE|CHECK|FOREIGN KEY)\b/, use: "isUniqueViolation() / isCheckViolation() from lib/database/errors" },
];

function appFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "lib", "app", "components", "proxy.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("lib/database/"));
}

const COMMENT = /^\s*(\*|\/\/|\/\*)/;

describe("SQL dialect guard", () => {
  it("app code uses no SQLite-only spelling", () => {
    const hits: string[] = [];
    for (const file of appFiles()) {
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (COMMENT.test(line)) return;
          for (const b of BANNED) if (b.re.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}  ->  ${b.use}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

describe("dialect helpers", () => {
  it("spell PostgreSQL's forms", async () => {
    const { stringAgg, daysBetween } = await import("@/lib/database/dialect");
    expect(stringAgg("x", { distinct: true })).toBe("string_agg(DISTINCT CAST(x AS text), ',')");
    expect(daysBetween("a", "?")).toBe("(CAST(a AS date) - CAST(? AS date))");
  });
});
