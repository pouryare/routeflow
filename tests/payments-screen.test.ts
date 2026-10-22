import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The payments screen's rules, asserted on source.
 *
 * Same reasoning as tests/accounting-nav.test.ts: the failures guarded here are all
 * "someone removed a guarantee while the page still looked finished". A rendered snapshot
 * would not notice a totals card quietly starting to count voided money.
 */
const panel = readFileSync("components/sales/PaymentsPanel.tsx", "utf8") + "\n" + readFileSync("lib/paymentsView.ts", "utf8"); // the screen and its extracted arithmetic
const route = readFileSync("app/api/payments/[id]/route.ts", "utf8");

describe("the payments screen", () => {
  it("never counts a VOIDED receipt in a total", () => {
    // A void means the money went back. Counting it and calling the card "collected this
    // month" is the single most misleading number this screen could print.
    expect(panel).toMatch(/const live = useMemo\(\(\) => \(payments \?\? \[\]\)\.filter\(\(p\) => !p\.voided_at\)/);
    // Every card builds from `live`, not from `payments`.
    const cardSection = panel.slice(panel.indexOf("const totals = useMemo"));
    expect(cardSection).toMatch(/live\.filter/);
    expect(cardSection).not.toMatch(/payments\s*\?\?\s*\[\]\)\.filter/);
  });

  it("hides voided rows BY DEFAULT rather than showing them as live money", () => {
    expect(panel).toMatch(/useState<"hide" \| "only" \| "all">\("hide"\)/);
    expect(panel).toMatch(/if \(f\.voided === "hide" && p\.voided_at\) return false/);
  });

  it("keeps a voided row VISIBLE and struck through when you ask to see it", () => {
    // Filtering voided rows out entirely would produce exactly the single clean number the
    // append-only design refuses.
    expect(panel).toMatch(/line-through opacity-50/);
    expect(panel).toMatch(/ابطال‌شده/);
  });

  it("the void button says it writes a reversing entry, because it does", () => {
    // Task 4 made void post a reversal. A button still labelled plain «ابطال» invites a
    // user to believe they are deleting a receipt that in fact stays forever.
    expect(panel).toMatch(/ابطال \+ ثبت معکوس/);
    expect(panel).toMatch(/سند معکوس/);
  });

  it("exports CSV with a BOM, or Excel shows mojibake labels", () => {
    expect(panel).toContain('type: "text/csv;charset=utf-8;"');
    // A bare UTF-8 CSV on Windows Excel reads as Latin-1 and turns every Persian word into
    // mojibake -- a spreadsheet whose row labels are all wrong.
    expect(panel).toMatch(/return "\uFEFF"|return "﻿"/); // the CSV text now starts with the BOM (lib/paymentsView.ts)
  });

  it("exports the FILTERED set, not everything, so the file matches the screen", () => {
    expect(panel).toMatch(/paymentsCsv\(filtered, customerName\)/);
  });

  it("paginates rather than rendering every receipt at once", () => {
    expect(panel).toMatch(/const PAGE_SIZE = \d+/);
    expect(panel).toMatch(/filtered\.slice\(safePage \* PAGE_SIZE/);
  });

  it("groups by month, derived at render rather than stored", () => {
    expect(panel).toMatch(/const months = useMemo/);
    expect(panel).toMatch(/p\.received_at\.slice\(0, 7\)/);
  });

  it("offers an EDITABLE allocation, and shows the on-account remainder explicitly", () => {
    // The change a user feels most: today allocation is FIFO and invisible.
    expect(panel).toMatch(/async function openAllocation/);
    // The payload must actually carry the draft. M50b sent `allocations: []` -- an empty
    // edit -- and passed, because "uses PATCH" does not mean "sends what the user typed".
    // Single-line match: the call is written on one line, and the `s` flag needs an ES2018
    // target this project does not set.
    expect(panel).toMatch(
      /JSON\.stringify\(\{ allocations: draft\.filter\(\(d\) => d\.amount_toman > 0\) \}\)/
    );
    expect(panel).not.toMatch(/JSON\.stringify\(\{ allocations: \[\] \}\)/);
    // order_id null is on-account credit and must be an explicit field, not a silent gap.
    expect(panel).toMatch(/d\.order_id === null/);
    expect(panel).toMatch(/باقی‌مانده روی حساب مشتری/);
  });

  it("the API re-checks the payment's tenant rather than trusting the client's id", () => {
    expect(route).toMatch(/getPayment\(guard\.session\.organizationId, paymentId\)/);
    // And the repo re-reads it under its own scope, so a forged id fails there too.
    expect(route).toMatch(/replaceAllocations\(guard\.session\.organizationId/);
  });

  it("sends the open orders with the payment, so the picker has something to offer", () => {
    expect(route).toMatch(/openOrders:/);
    expect(route).toMatch(/openOrdersOf/); // the adapter around deliveredOrdersForCustomer
  });

  it("the allocation write is a PATCH, not a second POST that could void by accident", () => {
    // POST on this route is `?action=void`. A PATCH cannot collide with it by accident.
    expect(route).toMatch(/export async function PATCH/);
    expect(route).toMatch(/action"\) !== "void"/);
  });
});