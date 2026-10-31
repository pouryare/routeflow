import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* A destructive click must be guarded: irreversible ones ask first, reversible ones can be undone.
   This is a source-level guard, like the other walk-the-tree tests here: it fails when one of these
   handlers loses its question or its undo. Policy (docs/mobile-first-principles.md rule 6). */
const GUARDED: [file: string, mustContain: string][] = [
  /* The order panel no longer uses a browser dialog: cancel, return, failed delivery and credit
     rejection open a tap-flow sheet that asks (why, or "are you sure"), writes nothing until it is
     answered, and then gives a 5 s undo. The guard is that the handler routes them through it. */
  ["components/sales/OrderStatusPanel.tsx", "needsAsk(action)"],
  /* Reversible or recoverable actions do not ask: they act, toast and give «بازگردانی» for 5 s.
     Held-write undo (the write is only sent after the window): */
  ["app/(shell)/sales/admin/holidays/page.tsx", "useUndoableAction"],
  ["app/(shell)/gallery/page.tsx", "useUndoableAction"],
  ["components/PhotoGallery.tsx", "useUndoableAction"],
  ["app/(shell)/sales/admin/users/page.tsx", "useUndoableAction"],
  ["app/(shell)/leads/hooks/useLeads.ts", "useUndoableAction"],
  /* Undo by restoring what was deleted: */
  ["app/(shell)/facilities/page.tsx", "restore("],
  ["app/(shell)/leads/hooks/useLeads.ts", "بازگردانی فهرست"],
  /* The one irreversible action left: a recall raises a reminder for every customer who received
     the lot and cannot be undone, so its button turns into the question in place (no dialog),
     saying what will happen. */
  ["components/sales/BatchesPanel.tsx", "recallArmed"],
];

describe("destructive actions are guarded", () => {
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
