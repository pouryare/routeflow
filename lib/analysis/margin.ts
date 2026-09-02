/** Contribution margin roll-up — a pure module, no `db` import.
 *
 *  The source (§6) flags Gross Profit and Contribution Margin as *missing from your
 *  current dashboard* and calls revenue-only dashboards dangerous: sales can rise
 *  while profit falls. This module is the arithmetic behind the fix — group priced,
 *  delivered order lines by any dimension and show what each contributes to profit,
 *  not just to revenue.
 *
 *  Every input is already a frozen, delivered-quantity figure (lineTotalToman /
 *  lineCostToman / lineKg from lib/orderMath). This module does not know what an order
 *  is; it sums `Keyed` rows and derives the ratios.
 */

export interface MarginLine {
  revenue_toman: number;
  cost_toman: number;
  kg: number;
}

export interface Keyed extends MarginLine {
  /** the grouping value — a customer id as text, a product name, a salesperson name … */
  key: string;
  label: string;
}

export interface MarginRow extends MarginLine {
  key: string;
  label: string;
  /** revenue − cost, whole Toman */
  margin_toman: number;
  /** margin_toman / revenue_toman, 0 when revenue ≤ 0 */
  margin_pct: number;
  /** this row's margin as a share of the total positive-or-negative margin, 0 when the
   *  total is 0 — lets a table show "this one customer is 40% of our profit" */
  share_pct: number;
}

/** Gross margin as a 0–1 ratio. 0 when there is no revenue to take a share of — a row
 *  that sold nothing has an undefined margin percent, not a 100% one. */
export function marginPct(revenue: number, cost: number): number {
  if (revenue <= 0) return 0;
  return (revenue - cost) / revenue;
}

/** Sum `Keyed` lines by `key`, derive the three ratios, sort by absolute profit
 *  contribution descending so the rows that make (or lose) the most money are first. */
export function rollUp(lines: Keyed[]): MarginRow[] {
  const byKey = new Map<string, Keyed>();
  for (const line of lines) {
    const acc = byKey.get(line.key);
    if (acc) {
      acc.revenue_toman += line.revenue_toman;
      acc.cost_toman += line.cost_toman;
      acc.kg += line.kg;
    } else {
      byKey.set(line.key, { ...line });
    }
  }

  const rows: MarginRow[] = [...byKey.values()].map((r) => ({
    ...r,
    margin_toman: r.revenue_toman - r.cost_toman,
    margin_pct: marginPct(r.revenue_toman, r.cost_toman),
    share_pct: 0,
  }));

  const totalMargin = rows.reduce((sum, r) => sum + r.margin_toman, 0);
  if (totalMargin !== 0) {
    for (const r of rows) r.share_pct = r.margin_toman / totalMargin;
  }

  rows.sort((a, b) => b.margin_toman - a.margin_toman);
  return rows;
}
