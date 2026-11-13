/** A5 «ورودی و خروجی پول»: what moved through cash and bank in a month, in plain words. Pure.
 *  Example: receipts 900, a purchase -300 and rent -200 give in 900, out 500, so opening 1,000 closes at 1,400. */
export const MONEY_CODES = ["1101", "1102", "1103"] as const;

const SOURCE_LABEL: Record<string, string> = {
  PAYMENT: "دریافت از مشتری",
  CHEQUE: "وصول چک",
  SALE: "فروش",
  PURCHASE: "خرید کالا",
  SUPPLIER_PAYMENT: "پرداخت به تأمین‌کننده",
  EXPENSE: "هزینه",
  OPENING: "مانده اول دوره",
  MANUAL: "سند دستی و انتقال",
  REVERSAL: "ابطال",
  COMMISSION_PAYMENT: "پورسانت",
  PARTNER_ADVANCE: "علی‌الحساب شرکا",
  DIVIDEND_PAYMENT: "سود شرکا",
  HANDOVER: "تحویل صندوق",
};

export const moneyLabel = (sourceType: string): string => SOURCE_LABEL[sourceType] ?? sourceType;

export interface MoneyRow { label: string; net: number }
export interface MoneyFlow { opening: number; closing: number; totalIn: number; totalOut: number; inRows: MoneyRow[]; outRows: MoneyRow[] }

/** Splits signed rows (debit minus credit on the money accounts) into money in and money out, biggest first.
 *  A row that nets to zero (a move between own accounts) is left out. */
export function splitMoney(opening: number, rows: MoneyRow[]): MoneyFlow {
  const inRows = rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const outRows = rows.filter((r) => r.net < 0).map((r) => ({ label: r.label, net: -r.net })).sort((a, b) => b.net - a.net);
  const totalIn = inRows.reduce((s, r) => s + r.net, 0);
  const totalOut = outRows.reduce((s, r) => s + r.net, 0);
  return { opening, closing: opening + totalIn - totalOut, totalIn, totalOut, inRows, outRows };
}
