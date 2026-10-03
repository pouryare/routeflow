import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");

/** Runs a probe script through the hook. Returns stdout AND stderr together — deprecation
 *  warnings are emitted on stderr, so capturing stdout alone would silently miss them and
 *  the DEP0205 test would pass against a deprecated implementation. */
function probe(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-hook-"));
  const file = path.join(dir, "probe.ts");
  fs.writeFileSync(file, body);
  try {
    /* `spawnSync` rather than `execFileSync`: execFileSync hands back stdout only, and a
       deprecation warning arrives on stderr — so the DEP0205 assertion would pass against a
       deprecated implementation unless stderr is captured explicitly. */
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--import", path.join(REPO, "scripts/_ts-register.mjs"), file],
      {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, SESSION_SECRET: "x" },
      },
    );
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("the ts resolution hook", () => {
  it("resolves the @/ alias into lib/", () => {
    expect(probe(`
      import { FULFILLED_ORDER_STATUSES } from "@/lib/orderStateMachine";
      console.log("OK", Array.isArray(FULFILLED_ORDER_STATUSES));
    `)).toContain("OK true");
  });

  it("resolves an extensionless relative import", () => {
    expect(probe(`
      import { marginPct } from "@/lib/analysis/margin";
      console.log("OK", marginPct(100, 60) === 0.4);
    `)).toContain("OK true");
  });

  it("stubs next/server so a module importing it as a value still loads", () => {
    /* This must target a module that ACTUALLY reaches next/server, or the test proves
     * nothing. `lib/repo/margin.ts:14` imports `orderFilter` — a value — from
     * `@/lib/session`, whose line 1 imports `next/server`. `lib/repo/ledger.ts` does NOT
     * import session at all, so probing that one would pass with the stub removed. */
    expect(probe(`
      import { marginBy } from "@/lib/repo/margin";
      console.log("OK", typeof marginBy);
    `)).toContain("OK function");
  });

  it("does not print the DEP0205 deprecation warning", () => {
    const out = probe(`
      import { getDb } from "@/lib/db";
      console.log("OK", typeof getDb === "function");
    `);
    expect(out).not.toContain("DEP0205");
  });
});
