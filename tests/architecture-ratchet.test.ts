import { describe, it, expect } from "vitest";

/* The tool behind `npm run check:architecture`. The ratchet itself runs in CI; this pins the
 * two pieces of logic that could quietly make it useless: what counts as a runtime import, and
 * whether a cycle is actually found. */
const { valueImports, cycles, measure } = await import("../scripts/check-architecture.mjs");

describe("valueImports", () => {
  it("keeps runtime imports and re-exports, drops type-only ones", () => {
    const src = `
import { a } from "@/lib/a";
import type { T } from "@/lib/types";
import { type U, type V } from "@/lib/onlyTypes";
import { w, type X } from "./mixed";
export { b } from "./b";
export type { Y } from "./y";
import "./side-effect";
import def from "../def";
`;
    expect(valueImports(src)).toEqual(["@/lib/a", "./mixed", "./b", "./side-effect", "../def"]);
  });
});

describe("cycles", () => {
  const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges).map(([k, v]) => [k, new Set(v)]));

  it("finds a three-file cycle and ignores the acyclic rest", () => {
    const found = cycles(graph({ a: ["b"], b: ["c"], c: ["a"], d: ["a"], e: [] }));
    expect(found).toEqual([["a", "b", "c"]]);
  });

  it("finds two separate cycles and counts a self-import", () => {
    expect(cycles(graph({ a: ["b"], b: ["a"], c: ["d"], d: ["c"], e: ["e"] })).length).toBe(3);
  });

  it("reports nothing for a DAG", () => {
    expect(cycles(graph({ a: ["b", "c"], b: ["c"], c: [] }))).toEqual([]);
  });
});

describe("measure", () => {
  it("returns a number for every metric the baseline records", () => {
    const { totals } = measure();
    expect(Object.keys(totals).sort()).toEqual(
      ["agentLitterFiles", "dbImportsOutsideLib", "dbModuleLines", "importCycles", "rawRoleChecks", "unscopedTenantSelects"].sort(),
    );
    for (const v of Object.values(totals)) expect(Number.isFinite(v)).toBe(true);
  });
});
