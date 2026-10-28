import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("SyncEngine.start", () => {
  it("runs its first cycle after the page has loaded and the browser is idle, not at hydration", () => {
    const src = readFileSync("lib/offline/syncEngine.ts", "utf8");
    const start = /start\(\): void \{[\s\S]*?\n  \}\n/.exec(src)?.[0] ?? "";
    expect(start).toContain("requestIdleCallback");
    expect(start).toContain('addEventListener("load"');
    expect(start).not.toMatch(/^\s*kick\(\);\s*$/m);
  });
});
