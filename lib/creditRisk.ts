/** F46: a transparent credit-risk score from how a customer pays. Pure; advisory only (it never blocks an order).
 *  Points add up to at most 100; the three biggest reasons are shown with the score.
 *  Example: 45 days overdue (30) + one bounced cheque (15) + at the limit (20) = 65, «زیاد». */

export interface RiskInput {
  /** Days the oldest unpaid delivered order is past its due date; 0 when nothing is overdue. */
  overdueDays: number;
  /** Cheques that bounced in the last 180 days. */
  bouncedCheques: number;
  /** What they owe now and their limit; a null limit means no limit. */
  balanceToman: number;
  limitToman: number | null;
  /** Promises of the last 90 days that passed their date unpaid. */
  brokenPromises: number;
}

export type RiskLevel = "low" | "medium" | "high";
export interface RiskResult { score: number; level: RiskLevel; reasons: string[] }

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = { low: "کم", medium: "متوسط", high: "زیاد" };

const fa = (n: number) => n.toLocaleString("fa-IR");

export function creditRisk(i: RiskInput): RiskResult {
  const parts: { points: number; text: string }[] = [];
  const o = i.overdueDays;
  if (o > 0) parts.push({ points: o <= 15 ? 10 : o <= 30 ? 20 : o <= 60 ? 30 : 40, text: `${fa(o)} روز از سررسید گذشته` });
  if (i.bouncedCheques > 0) parts.push({ points: Math.min(30, 15 * i.bouncedCheques), text: `${fa(i.bouncedCheques)} چک برگشتی در ۶ ماه اخیر` });
  if (i.limitToman !== null && i.limitToman > 0 && i.balanceToman > 0) {
    const used = i.balanceToman / i.limitToman;
    if (used >= 1) parts.push({ points: 20, text: "بدهی از سقف اعتبار گذشته" });
    else if (used >= 0.8) parts.push({ points: 10, text: `${fa(Math.round(used * 100))}٪ سقف اعتبار پر شده` });
  }
  if (i.brokenPromises > 0) parts.push({ points: Math.min(20, 10 * i.brokenPromises), text: `${fa(i.brokenPromises)} وعدهٔ پرداخت شکسته` });
  const score = Math.min(100, parts.reduce((s, p) => s + p.points, 0));
  parts.sort((a, b) => b.points - a.points);
  return { score, level: score < 25 ? "low" : score < 50 ? "medium" : "high", reasons: parts.slice(0, 3).map((p) => p.text) };
}
