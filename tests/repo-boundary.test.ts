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

describe("raw SQL lives in lib/repo/ or on the grandfather allowlist", () => {
  it("introduces no new raw-SQL file outside lib/repo/", () => {
    const allow = new Set(readList(fs.readFileSync(ALLOWLIST, "utf8")));
    const offenders = rawSqlFiles().filter((f) => !f.startsWith("lib/repo/") && !allow.has(f));
    expect(offenders, `new raw SQL outside lib/repo/:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the allowlist only shrinks — no path added versus git HEAD", () => {
    const headText = execSync(`git show HEAD:${ALLOWLIST} 2>/dev/null || true`, { encoding: "utf8" });
    const headList = readList(headText);
    if (headList.length === 0) return; // first commit that introduces the allowlist
    const nowList = readList(fs.readFileSync(ALLOWLIST, "utf8"));
    const added = nowList.filter((p) => !headList.includes(p));
    expect(added, `allowlist grew:\n${added.join("\n")}`).toEqual([]);
  });

  it("every allowlisted path still exists (prune deleted files)", () => {
    const missing = readList(fs.readFileSync(ALLOWLIST, "utf8")).filter((p) => !fs.existsSync(p));
    expect(missing, `stale allowlist entries — delete these lines:\n${missing.join("\n")}`).toEqual([]);
  });
});
