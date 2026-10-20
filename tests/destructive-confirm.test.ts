import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* A destructive click must ask first. This is a source-level guard, like the other
   walk-the-tree tests here: it fails when one of these handlers loses its question. */
const GUARDED: [file: string, mustContain: string][] = [
  ["components/sales/OrderStatusPanel.tsx", "CONFIRM_TEXT[action]"],
  ["app/(shell)/sales/admin/holidays/page.tsx", "confirmAction("],
  ["app/(shell)/gallery/page.tsx", "confirmAction("],
  ["app/(shell)/facilities/page.tsx", "confirmAction("],
  ["components/PhotoGallery.tsx", "confirmAction("],
  ["app/(shell)/sales/admin/users/page.tsx", "confirmAction("],
  ["app/(shell)/leads/hooks/useLeads.ts", "confirmAction("],
];

describe("destructive actions ask before acting", () => {
  it.each(GUARDED)("%s", (file, needle) => {
    expect(readFileSync(file, "utf8")).toContain(needle);
  });
  it("cancel, return and credit-rejection are all on the order panel's confirm list", () => {
    const src = readFileSync("components/sales/OrderStatusPanel.tsx", "utf8");
    for (const a of ["cancel", "returnOrder", "rejectCredit"]) expect(src).toMatch(new RegExp(`${a}:\\s*"`));
  });
});
