import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SQL outside lib/database/ is written so PostgreSQL can run it too (Wave P, phase 1).
 *
 *  Each spelling below works in SQLite and not in PostgreSQL, or works in both and means
 *  something different. The portable form is named next to it; lib/database/dialect.ts holds
 *  the helpers. lib/database/ itself is the SQLite adapter and its schema and migrations, so
 *  it may speak SQLite; scripts/ seed a SQLite file directly and move with the seeds.
 *
 *  A comment line that mentions a spelling is prose, not SQL, and is not counted. */

const ROOT = join(__dirname, "..");

const BANNED: { re: RegExp; use: string }[] = [
  { re: /\bdate\(\s*'now'/i, use: "pass tehranTodayIso() as a parameter (date('now') is the UTC day)" },
  { re: /\bdatetime\(\s*'now'/i, use: "pass new Date().toISOString() as a parameter" },
  { re: /\bjulianday\(/i, use: "daysBetween() from lib/database/dialect" },
  { re: /\bstrftime\(/i, use: "format the date in TypeScript" },
  { re: /\bgroup_concat\(/i, use: "stringAgg() from lib/database/dialect" },
  { re: /\bINSERT\s+OR\s+(IGNORE|REPLACE)\b/i, use: "INSERT ... ON CONFLICT DO NOTHING / DO UPDATE" },
  { re: /\blast_insert_rowid\(/i, use: "the run() result's lastInsertRowid" },
  { re: /\bPRAGMA\b/, use: "nothing outside lib/database/: the schema is fixed once migrations have run" },
  { re: /\bsqlite_master\b/i, use: "nothing outside lib/database/" },
  { re: /\bIFNULL\(/i, use: "COALESCE()" },
];

/* The one-shot CRM column migration, which is SQLite's own upgrade path and has no PostgreSQL
   counterpart: the PostgreSQL schema is created whole. */
const ALLOWED: Record<string, string> = {
  "lib/repo/crm/migrate.ts": "adds missing columns to an old SQLite file; PostgreSQL starts from the full schema",
};

function appFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "lib", "app", "components", "proxy.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("lib/database/") && !(f in ALLOWED));
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

  it("every allowlist entry is still needed and says why", () => {
    for (const [file, why] of Object.entries(ALLOWED)) {
      expect(why.length, file).toBeGreaterThan(20);
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(BANNED.some((b) => b.re.test(text)), `${file} no longer needs its entry`).toBe(true);
    }
  });
});

describe("dialect helpers", () => {
  it("spell each dialect's own form", async () => {
    const { stringAgg, daysBetween } = await import("@/lib/database/dialect");
    const before = process.env.DB_DIALECT;
    try {
      delete process.env.DB_DIALECT;
      expect(stringAgg("x", { distinct: true })).toBe("GROUP_CONCAT(DISTINCT x)");
      expect(daysBetween("a", "?")).toBe("(julianday(a) - julianday(?))");
      process.env.DB_DIALECT = "postgres";
      expect(stringAgg("x", { distinct: true })).toBe("string_agg(DISTINCT CAST(x AS text), ',')");
      expect(daysBetween("a", "?")).toBe("(CAST(a AS date) - CAST(? AS date))");
    } finally {
      if (before === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = before;
    }
  });
});
