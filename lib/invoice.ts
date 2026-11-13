/** D7: the numbers on an official invoice. Pure. Prices already include VAT, so the invoice splits it out of the line total.
 *  Example: a line of 1,100,000 at 10% is 1,000,000 before VAT and 100,000 VAT. */
import { roundToman } from "./money";

/** A tax code is typed digits only: an economic code (12 or 14 digits) or a national ID (10 or 11). */
export function parseTaxId(v: unknown): string | null | "bad" {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v !== "string") return "bad";
  const digits = v.trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  return /^\d{10,14}$/.test(digits) ? digits : "bad";
}

/** The VAT inside a VAT-inclusive amount. */
export function vatInside(gross: number, pct: number): number {
  return pct > 0 ? roundToman((gross * pct) / (100 + pct)) : 0;
}

export interface InvoiceLineIn { total_toman: number; vat_pct: number }

/** Totals of an invoice. A discount lowers every line in proportion, so VAT follows it.
 *  shortcut: the discount is spread over the VAT total, not line by line; fine while rates differ by a few percent. */
export function invoiceTotals(lines: InvoiceLineIn[], discountToman: number) {
  const gross = lines.reduce((s, l) => s + l.total_toman, 0);
  const net = Math.max(0, gross - Math.max(0, discountToman));
  const vatGross = lines.reduce((s, l) => s + vatInside(l.total_toman, l.vat_pct), 0);
  const vat = gross > 0 ? roundToman((vatGross * net) / gross) : 0;
  return { gross, net, vat, beforeVat: net - vat };
}

/** «۱۴۰۵/۰۰۰۱۲۳» in Latin digits so it can be typed into a search box. */
export const invoiceNumberText = (year: number, no: number) => `${year}/${String(no).padStart(6, "0")}`;
