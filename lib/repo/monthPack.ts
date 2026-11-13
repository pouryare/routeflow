import ExcelJS from "exceljs";
import { getDb } from "@/lib/db";
import { jalaliMonthLength, jalaliToIsoDate, faJalaliDate } from "@/lib/jalali";
import { moneyFlow } from "./moneyFlow";
import { incomeStatement, journalReport } from "./reports";
import { stockOnDate } from "./stockOnDate";
import { LedgerError } from "./ledgerCore";

const MAX_JOURNALS = 5000;

function sheetOf(book: ExcelJS.Workbook, name: string, headers: string[]) {
  const sheet = book.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  sheet.addRow(headers).font = { bold: true };
  sheet.columns = headers.map((h) => ({ width: Math.max(16, h.length + 4) }));
  return sheet;
}

/** D26: one workbook for the accountant, for a CLOSED month: trial balance at month end, profit and loss, money in and
 *  out, stock at month end and the month's journal. Numbers come from the same readers the screens use. */
export async function monthPack(organizationId: number, periodKey: string): Promise<ExcelJS.Workbook> {
  const closed = await getDb().prepare("SELECT 1 AS ok FROM fiscal_periods WHERE organization_id = ? AND period_key = ? AND status = 'closed'").get(organizationId, periodKey);
  if (!closed) throw new LedgerError("بستهٔ حسابدار فقط برای ماه بسته‌شده ساخته می‌شود");
  const [jy, jm] = periodKey.split("-").map(Number);
  const lastDay = jalaliToIsoDate(jy, jm, jalaliMonthLength(jy, jm));
  const book = new ExcelJS.Workbook();
  book.creator = "routeflow";
  book.created = new Date();

  const tb = (await getDb()
    .prepare(
      `SELECT a.code, a.name_fa AS name,
              COALESCE(SUM(CASE WHEN e.side = 'D' THEN e.amount_toman END), 0) AS debit,
              COALESCE(SUM(CASE WHEN e.side = 'C' THEN e.amount_toman END), 0) AS credit
         FROM ledger_entries e JOIN journals j ON j.id = e.journal_id JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND j.period_key <= ? GROUP BY a.code, a.name_fa ORDER BY a.code`
    )
    .all(organizationId, periodKey)) as { code: string; name: string; debit: number; credit: number }[];
  const t = sheetOf(book, "تراز آزمایشی", ["کد", "حساب", "بدهکار", "بستانکار"]);
  for (const r of tb) t.addRow([r.code, r.name, Number(r.debit), Number(r.credit)]);

  const is = await incomeStatement(organizationId, { periodKey });
  const p = sheetOf(book, "سود و زیان", ["ردیف", "مبلغ (تومان)"]);
  p.addRow(["درآمد", is.revenueToman]);
  p.addRow(["بهای تمام‌شدهٔ کالا", is.cogsToman]);
  p.addRow(["سود ناخالص", is.grossProfitToman]);
  for (const e of is.expenses) p.addRow([e.nameFa, e.amountToman]);
  p.addRow(["سود خالص", is.netProfitToman]).font = { bold: true };

  const flow = await moneyFlow(organizationId, periodKey);
  const m = sheetOf(book, "ورودی و خروجی پول", ["ردیف", "مبلغ (تومان)"]);
  m.addRow(["مانده اول ماه", flow.opening]);
  for (const r of flow.inRows) m.addRow([`ورودی: ${r.label}`, r.net]);
  for (const r of flow.outRows) m.addRow([`خروجی: ${r.label}`, -r.net]);
  m.addRow(["مانده آخر ماه", flow.closing]).font = { bold: true };

  const stock = await stockOnDate(organizationId, lastDay);
  const s = sheetOf(book, "موجودی پایان ماه", ["کالا", "تعداد", "واحد", "ارزش (تومان، به بهای میانگین امروز)"]);
  for (const r of stock) s.addRow([r.name, r.qty, r.baseUnit, r.valueToman]);

  const journal = await journalReport(organizationId, { periodKey, limit: MAX_JOURNALS });
  const j = sheetOf(book, "دفتر روزنامه", ["شمارهٔ سند", "تاریخ", "شرح", "حساب", "بدهکار", "بستانکار"]);
  for (const row of [...journal.rows].reverse()) {
    for (const leg of row.legs) j.addRow([row.seq, faJalaliDate(row.postedAt), row.memo ?? "", `${leg.code} ${leg.nameFa}`, leg.side === "D" ? leg.amountToman : null, leg.side === "C" ? leg.amountToman : null]);
  }
  return book;
}
