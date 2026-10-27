/** How many rows of the margin table are drawn before the reader asks for the rest. The table is
 *  one row per customer (or product, salesperson...), which on a real ledger is hundreds of rows
 *  and a page 14,000 pixels tall for something people read the top of. */
export const MARGIN_ROW_LIMIT = 15;

export function visibleRows<T>(rows: T[], expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || rows.length <= MARGIN_ROW_LIMIT) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, MARGIN_ROW_LIMIT), hidden: rows.length - MARGIN_ROW_LIMIT };
}

/** The rows ordered by the column the reader tapped; no descriptor keeps the server's order.
 *  Names sort in Persian order, numbers by value. Never mutates its input. */
export function sortRows<T extends object>(
  rows: T[],
  sort: { column: string | number; direction: "ascending" | "descending" } | undefined,
): T[] {
  if (!sort) return rows;
  const key = String(sort.column) as keyof T;
  const sign = sort.direction === "descending" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), "fa") * sign;
  });
}
