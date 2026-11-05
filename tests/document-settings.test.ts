import { describe, it, expect } from "vitest";
import { parseDocumentSettings, DEFAULT_RECEIPT_FOOTER } from "@/lib/documentSettings";
import { buildReceipt } from "@/lib/deliveryReceipt";

describe("receipt footer and order prefix (A13)", () => {
  it("takes blank as the default and capitalises the prefix", () => {
    expect(parseDocumentSettings({ receiptFooter: "  ", orderPrefix: "rf" })).toEqual({ receiptFooter: null, deliveryNoteFooter: null, orderPrefix: "RF" });
  });

  it("refuses a prefix with a dash, digits or Persian letters, and a long footer", () => {
    for (const p of ["R-F", "R1", "آر", "ABCDE"]) expect(typeof parseDocumentSettings({ orderPrefix: p })).toBe("string");
    expect(typeof parseDocumentSettings({ receiptFooter: "x".repeat(161) })).toBe("string");
  });

  it("prints the company footer, or the thanks when there is none", () => {
    const stop = { order_no: "RF1405-00001", customer_name: "c", address: null, phone: null, lines: [] } as never;
    const base = { stop, packs: {}, collectedToman: 0, runDate: "2026-11-05", driverName: "d", businessName: "b" };
    expect(buildReceipt(base).footer).toBe(DEFAULT_RECEIPT_FOOTER);
    expect(buildReceipt({ ...base, footer: "ارسال رایگان بالای یک میلیون" }).footer).toBe("ارسال رایگان بالای یک میلیون");
  });
});
