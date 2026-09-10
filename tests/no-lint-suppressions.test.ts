import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lint is clean because the code is, not because the linter was told to look away.
 *
 *  Thirty-three `eslint-disable` comments had built up, nearly all over
 *  react-hooks/set-state-in-effect, each with a paragraph explaining why this one was
 *  fine. They were removed by fixing the shapes instead: useRunAfterMount for loaders,
 *  useSyncExternalStore for facts about the browser, a restore-once on the first render
 *  after hydration for localStorage, adjusting state during render for values that
 *  follow a prop, and useLatest for callbacks an effect must not rebuild on. A new
 *  suppression is a new instance of one of those, and this test sends it back.
 *
 *  `@ts-expect-error` stays allowed: it fails the build the moment the error it expects
 *  goes away, so it cannot hide anything, and the tests use it to prove bad input does
 *  not type-check. `@ts-ignore` and `@ts-nocheck` hide errors silently and are not.
 */

const ROOT = join(__dirname, "..");
const SELF = "tests/no-lint-suppressions.test.ts";

/* Directive form only: a comment that *is* a suppression, not prose that mentions one. */
const DIRECTIVE = /^\s*(?:\/\/|\/\*|\{\s*\/\*)\s*(?:eslint-disable|@ts-ignore|@ts-nocheck)\b/;

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && f !== SELF);
}

describe("no lint or type suppressions", () => {
  it("has no eslint-disable, @ts-ignore or @ts-nocheck directive in any tracked source file", () => {
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (DIRECTIVE.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, `suppressions:\n${hits.join("\n")}`).toEqual([]);
  });
});
