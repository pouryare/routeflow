/** T8: cheques in hand grouped by due day, soonest first, with a toman sum per day. Pure.
 *  Example: two cheques due 10 Dey (100 and 50) and one due 12 Dey (30) give [{10 Dey, 150, 2}, {12 Dey, 30, 1}]; a cheque
 *  already past its day sits in the first group with its own date, so nothing overdue is lost from the top. */
export interface AgendaCheque { id: number; amount_toman: number; due_date: string; status: string }
export interface AgendaDay<T extends AgendaCheque = AgendaCheque> { date: string; totalToman: number; items: T[] }

export function chequeAgenda<T extends AgendaCheque>(cheques: T[]): AgendaDay<T>[] {
  const days = new Map<string, AgendaDay<T>>();
  for (const c of cheques) {
    if (c.status !== "in_hand") continue;
    const d = days.get(c.due_date) ?? { date: c.due_date, totalToman: 0, items: [] };
    d.items.push(c);
    d.totalToman += c.amount_toman;
    days.set(c.due_date, d);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
