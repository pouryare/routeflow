/** A report as a few big cards instead of a wide table: each section is a total, and a section
 *  made of many lines (the expenses) opens to show them. Pure, so what each card says and how its
 *  sign reads is tested without a page. */
export interface SummaryCard {
  id: string;
  label: string;
  value: number;
  strong?: boolean;
  total?: boolean;
  /** The lines behind the number, shown in a sheet when the card is tapped. */
  lines?: { label: string; value: number }[];
}

export interface IncomeStatementLike {
  revenueToman: number;
  cogsToman: number;
  grossProfitToman: number;
  expenses: { nameFa: string; amountToman: number }[];
  totalExpensesToman: number;
  netProfitToman: number;
}

/** Costs are shown negative, exactly as the table does, so the two never disagree. */
export function incomeStatementCards(is: IncomeStatementLike): SummaryCard[] {
  return [
    { id: "revenue", label: "درآمد", value: is.revenueToman, strong: true },
    { id: "cogs", label: "بهای تمام‌شدهٔ کالا", value: -is.cogsToman },
    { id: "gross", label: "سود ناخالص", value: is.grossProfitToman, strong: true },
    ...(is.totalExpensesToman
      ? [{ id: "expenses", label: "جمع هزینه‌ها", value: -is.totalExpensesToman, lines: is.expenses.map((e) => ({ label: e.nameFa, value: -e.amountToman })) }]
      : []),
    { id: "net", label: "سود خالص", value: is.netProfitToman, strong: true, total: true },
  ];
}
