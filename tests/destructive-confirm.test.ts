import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* A destructive click must ask first. This is a source-level guard, like the other
   walk-the-tree tests here: it fails when one of these handlers loses its question. */
const GUARDED: [file: string, mustContain: string][] = [
  /* The order panel no longer uses a browser dialog: cancel, return, failed delivery and credit
     rejection open a tap-flow sheet that asks (why, or "are you sure"), writes nothing until it is
     answered, and then gives a 5 s undo. The guard is that the handler routes them through it. */
  ["components/sales/OrderStatusPanel.tsx", "needsAsk(action)"],
  ["app/(shell)/sales/admin/holidays/page.tsx", "confirmAction("],
  ["app/(shell)/gallery/page.tsx", "confirmAction("],
  ["app/(shell)/facilities/page.tsx", "confirmAction("],
  ["components/PhotoGallery.tsx", "confirmAction("],
  ["app/(shell)/sales/admin/users/page.tsx", "confirmAction("],
  ["app/(shell)/leads/hooks/useLeads.ts", "confirmAction("],
  ["components/sales/BatchesPanel.tsx", "confirmAction("],
];

describe("destructive actions ask before acting", () => {
  it.each(GUARDED)("%s", (file, needle) => {
    expect(readFileSync(file, "utf8")).toContain(needle);
  });
  it("cancel, return, failed delivery and credit-rejection all open the sheet instead of firing", async () => {
    const { needsAsk, CONSEQUENCE } = await import("@/lib/flows/orderAction");
    for (const a of ["cancel", "returnOrder", "failDelivery", "rejectCredit"] as const) {
      expect(needsAsk(a)).toBe(true);
      expect(CONSEQUENCE[a]).toBeTruthy(); // it says what will happen before it happens
    }
  });
});
