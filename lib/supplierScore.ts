/** F31: how a supplier keeps their word, from purchase orders. Pure.
 *  Example: 4 orders with an expected day, 3 arrived on or before it → on time 75%; one arrived 2 days late → 2 days average
 *  lateness among the late ones. An order closed short counts as «کسری», not as on time. */
export interface ScoredOrder { status: string; expected_date: string | null; arrived_day: string | null }
export interface Scorecard { finished: number; judged: number; onTime: number; avgLateDays: number; closedShort: number }

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function scorecard(orders: ScoredOrder[]): Scorecard {
  const done = orders.filter((o) => o.status === "received" || o.status === "closed");
  const judged = done.filter((o) => o.status === "received" && o.expected_date && o.arrived_day);
  const late = judged.map((o) => dayDiff(o.arrived_day!, o.expected_date!)).filter((d) => d > 0);
  return {
    finished: done.length,
    judged: judged.length,
    onTime: judged.length - late.length,
    avgLateDays: late.length ? Math.round((late.reduce((a, b) => a + b, 0) / late.length) * 10) / 10 : 0,
    closedShort: done.filter((o) => o.status === "closed").length,
  };
}
