import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";

const ALLOWLIST = "tests/fixtures/raw-sql-allowlist.txt";

/** Repo-relative paths under app/ or lib/ that contain a raw `.prepare(` or a
 *  `.exec("<sql>")` / `.exec(`<sql>`)`. */
function rawSqlFiles(): string[] {
  const out = execSync(
    `grep -rlnE '\\.prepare\\(|\\.exec\\(\\s*\\\`|\\.exec\\(\\s*"' app lib || true`,
    { encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function readList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Route groups — `app/(shell)/…`, `app/(bare)/…` — are organisational only: they change
 *  no URL and move no code between files. Moving a page into one must not read as a new
 *  raw-SQL offender to the ratchet below, which exists to stop raw SQL appearing in NEW
 *  files, not to freeze the directory layout. Comparing on the group-stripped path keeps
 *  that guarantee while letting the app be reorganised. */
function withoutRouteGroups(p: string): string {
  return p.replace(/\/\([^)]+\)/g, "");
}

/** Where raw SQL is allowed without an allowlist entry: the repositories, and lib/database/, the
 *  schema and boot layer that lib/db.ts's getDb() runs (seeds, backfills, table rebuilds). The
 *  second was carved out of lib/db.ts, itself grandfathered, so no new SQL appears: the code
 *  only moved. */
const SANCTIONED = ["lib/repo/", "lib/database/"];

describe("raw SQL lives in lib/repo/, lib/database/ or on the grandfather allowlist", () => {
  it("introduces no new raw-SQL file outside them", () => {
    const allow = new Set(readList(fs.readFileSync(ALLOWLIST, "utf8")));
    const offenders = rawSqlFiles().filter((f) => !SANCTIONED.some((d) => f.startsWith(d)) && !allow.has(f));
    expect(offenders, `new raw SQL outside ${SANCTIONED.join(" and ")}:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the allowlist only shrinks — no path added versus git HEAD", () => {
    const headText = execSync(`git show HEAD:${ALLOWLIST} 2>/dev/null || true`, { encoding: "utf8" });
    const headList = readList(headText).map(withoutRouteGroups);
    if (headList.length === 0) return; // first commit that introduces the allowlist
    const nowList = readList(fs.readFileSync(ALLOWLIST, "utf8"));
    const added = nowList.filter((p) => !headList.includes(withoutRouteGroups(p)));
    expect(added, `allowlist grew:\n${added.join("\n")}`).toEqual([]);
  });

  it("every allowlisted path still exists (prune deleted files)", () => {
    const missing = readList(fs.readFileSync(ALLOWLIST, "utf8")).filter((p) => !fs.existsSync(p));
    expect(missing, `stale allowlist entries — delete these lines:\n${missing.join("\n")}`).toEqual([]);
  });
});

describe("the database handle stays below app/ and components/", () => {
  it("no route, page or component imports getDb (they call named operations in lib/repo)", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync(
      `grep -rlE "import \\{[^}]*\\bgetDb\\b[^}]*\\} from \\"@/lib/db\\"" app components || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    ).split("\n").filter(Boolean);
    expect(hits).toEqual([]);
  });
});
