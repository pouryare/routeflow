/** The payments screen's own arithmetic, apart from the React component: which receipts a filter keeps,
 *  today/week/month totals by method, the month sections and the CSV. Pure, so each can be tested alone. */

export const METHOD_LABEL: Record<string, string> = {
  CASH: "نقد",
  POS: "کارت‌خوان",
  CARD_TO_CARD: "کارت به کارت",
  CHEQUE: "چک",
  CREDIT_NOTE: "بستانکاری",
  OTHER: "سایر",
};

export interface Customer {
  id: number;
  business_name: string;
  customer_code: string;
}

export interface Payment {
  id: number;
  customer_id: number;
  amount_toman: number;
  method: string;
  received_at: string;
  reference: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason?: string | null;
}

export interface OpenOrder {
  id: number;
  total_toman: number;
  paid_toman: number;
  order_date: string;
}

export interface AllocationDraft {
  order_id: number | null;
  amount_toman: number;
}


export interface PaymentFilters {
  method: string;
  from: string;
  to: string;
  voided: "hide" | "only" | "all";
}

/** The receipts a filter keeps, newest first. A voided receipt's money is GONE, so "hide" is the default. */
export function filterPayments(payments: Payment[], f: PaymentFilters): Payment[] {
  const day = (iso: string) => iso.slice(0, 10);
  const rows = payments.filter((p) => {
    if (f.voided === "hide" && p.voided_at) return false;
    if (f.voided === "only" && !p.voided_at) return false;
    if (f.method && p.method !== f.method) return false;
    if (f.from && day(p.received_at) < f.from) return false;
    if (f.to && day(p.received_at) > f.to) return false;
    return true;
  });
  return rows.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
}

/** Today / week / month, by method, from the same live list the table shows, so a card and a row cannot disagree. */
export function paymentTotals(live: Payment[], todayISO: string, weekAgoISO: string) {
  const monthStart = todayISO.slice(0, 8) + "01";
  const window = (from: string) => live.filter((p) => p.received_at.slice(0, 10) >= from);
  const today = live.filter((p) => p.received_at.slice(0, 10) === todayISO);
  const build = (rows: Payment[]) => {
    const m = new Map<string, number>();
    for (const p of rows) m.set(p.method, (m.get(p.method) ?? 0) + p.amount_toman);
    return {
      total: rows.reduce((sum, p) => sum + p.amount_toman, 0),
      byMethod: [...m.entries()].sort((a, b) => b[1] - a[1]),
    };
  };
  return { today: build(today), week: build(window(weekAgoISO)), month: build(window(monthStart)) };
}

/** Jalali month sections: a flat list of 400 receipts is unreadable, grouped by month it is a story. */
export function groupByMonth(rows: Payment[]): [string, Payment[]][] {
  const m = new Map<string, Payment[]>();
  for (const p of rows) {
    const key = p.received_at.slice(0, 7);
    const arr = m.get(key);
    if (arr) arr.push(p);
    else m.set(key, [p]);
  }
  return [...m.entries()];
}

/** The CSV text. A BOM leads it, because Excel on Windows reads a bare UTF-8 CSV as Latin-1 and turns every
 *  Persian word into mojibake. */
export function paymentsCsv(rows: Payment[], customerName: (id: number) => string): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ["تاریخ", "مشتری", "مبلغ", "روش", "پیگیری", "یادداشت", "وضعیت"];
  const lines = rows.map((p) =>
    [
      p.received_at.slice(0, 10),
      customerName(p.customer_id),
      String(p.amount_toman),
      METHOD_LABEL[p.method] ?? p.method,
      p.reference ?? "",
      p.note ?? "",
      p.voided_at ? "ابطال‌شده" : "فعال",
    ]
      .map(esc)
      .join(",")
  );
  return "﻿" + [head.map(esc).join(","), ...lines].join("\n");
}
