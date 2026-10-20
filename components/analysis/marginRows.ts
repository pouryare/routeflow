/** How many rows of the margin table are drawn before the reader asks for the rest. The table is
 *  one row per customer (or product, salesperson...), which on a real ledger is hundreds of rows
 *  and a page 14,000 pixels tall for something people read the top of. */
export const MARGIN_ROW_LIMIT = 15;

export function visibleRows<T>(rows: T[], expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || rows.length <= MARGIN_ROW_LIMIT) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, MARGIN_ROW_LIMIT), hidden: rows.length - MARGIN_ROW_LIMIT };
}
