import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("CrmBoard first render", () => {
  it("does not re-fetch the list the server already rendered", () => {
    const src = readFileSync("components/crm/CrmBoard.tsx", "utf8");
    expect(src).toContain("showingInitial");
    // the first effect run returns before scheduling load()
    expect(/showingInitial\.current\)\s*{[\s\S]*?return;[\s\S]*?}\s*const t = window\.setTimeout/.test(src)).toBe(true);
  });
});
