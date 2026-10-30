import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* Tables are for desktop only (owner rule, 2026-10-30): on a phone every table is a stack of cards.
   A page writes <CardTable> (or AcctTable), never a bare <table>, so the card layout cannot be
   forgotten. Files below may keep a <table>, each for a stated reason. */
const ALLOWED: Record<string, string> = {
  "components/CardTable.tsx": "the component itself",
  "components/accounting/AcctTable.tsx": "the accounting table, which does the same through labelCells",
  "app/(shell)/sales/admin/users/page.tsx": "uses the acct-cards class and labelCells directly",
  "components/sales/BatchesPanel.tsx": "uses the acct-cards class and labelCells directly (its rows carry buttons and extra rows)",
  "app/(bare)/print/price-list/page.tsx": "a paper page: the table is what is printed",
  "app/(bare)/print/run/[id]/page.tsx": "a paper page: the table is what is printed",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("no bare tables on a phone", () => {
  it("every <table> is a CardTable, or listed with a reason", () => {
    const bare = [...walk("app"), ...walk("components")].filter((f) => /<table[\s>]/.test(readFileSync(f, "utf8"))).filter((f) => !(f in ALLOWED));
    expect(bare).toEqual([]);
  });
  it("a HeroUI <Table> grid always has a CardTable beside it for phones", () => {
    const grids = [...walk("app"), ...walk("components")].filter((f) => /<Table[\s>]/.test(readFileSync(f, "utf8")));
    expect(grids.length).toBeGreaterThan(0);
    for (const f of grids) expect(readFileSync(f, "utf8")).toContain("<CardTable");
  });
  it("every allowed file still has a table (drop a line when its table goes)", () => {
    for (const f of Object.keys(ALLOWED)) expect(readFileSync(f, "utf8")).toMatch(/<table[\s>]|acct-cards/);
  });
});
