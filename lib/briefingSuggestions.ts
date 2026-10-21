/** Suggestions on the briefing: who to call, and who is due to order again. Pure, so "which
 *  three, in what order, and why" is tested without a database.
 *
 *  Two signals feed it:
 *   - churn: the model says this customer is likely to leave (probability and its own reason);
 *   - reorder: this customer orders every N days and has gone longer than that.
 *  A customer appearing in both is shown once, as churn (the more urgent reading). Every card
 *  carries a one-line *why*, because a suggestion nobody can check is one nobody trusts. */
export interface ReorderSignal {
  customerId: number;
  name: string;
  phone: string | null;
  daysSinceLast: number;
  typicalGapDays: number;
}
export interface ChurnSignal {
  customerId: number;
  name: string;
  phone: string | null;
  probability: number;
  reason: string | null;
}

export interface Suggestion {
  key: string;
  kind: "churn" | "reorder";
  customerId: number;
  title: string;
  why: string;
  score: number;
  /** The one thing to do about it. */
  primary: { kind: "call"; label: string; href: string } | { kind: "order"; label: string; href: string };
  /** Offered after the call or instead of it. */
  secondary?: { label: string; href: string };
}

export const MAX_SUGGESTIONS = 3;
export const SUPPRESS_DAYS = 7;

const orderHref = (customerId: number) => `/sales/orders/new?customer=${customerId}&quick=1`;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The typical days between orders, from a customer's order dates (ISO days). Needs at least three
 *  orders to mean anything; otherwise null. */
export function typicalGap(orderDays: string[]): number | null {
  if (orderDays.length < 3) return null;
  const days = [...orderDays].sort().map((d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const gaps = days.slice(1).map((d, i) => Math.round(d - days[i])).filter((g) => g > 0);
  return gaps.length >= 2 ? Math.max(1, Math.round(median(gaps))) : null;
}

export function buildSuggestions(input: { churn: ChurnSignal[]; reorder: ReorderSignal[] }, limit = MAX_SUGGESTIONS): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<number>();

  for (const c of input.churn) {
    seen.add(c.customerId);
    out.push({
      key: `churn:${c.customerId}`,
      kind: "churn",
      customerId: c.customerId,
      title: `ممکن است ریزش کند: ${c.name}`,
      why: c.reason?.trim() || "الگوی خریدش شبیه مشتری‌هایی است که رفته‌اند",
      score: 1 + c.probability,
      primary: c.phone ? { kind: "call", label: "تماس بگیر", href: `tel:${c.phone}` } : { kind: "order", label: "ساخت سفارش", href: orderHref(c.customerId) },
      secondary: c.phone ? { label: "ساخت سفارش", href: orderHref(c.customerId) } : undefined,
    });
  }
  for (const r of input.reorder) {
    if (seen.has(r.customerId) || r.typicalGapDays <= 0 || r.daysSinceLast < r.typicalGapDays) continue;
    out.push({
      key: `reorder:${r.customerId}`,
      kind: "reorder",
      customerId: r.customerId,
      title: `موعد سفارش مجدد: ${r.name}`,
      why: `آخرین سفارش ${toFa(r.daysSinceLast)} روز پیش، معمولاً هر ${toFa(r.typicalGapDays)} روز`,
      // How far past their rhythm, capped so one long-gone customer cannot outrank every real risk.
      score: Math.min(r.daysSinceLast / r.typicalGapDays, 2) / 2,
      primary: { kind: "order", label: "ساخت سفارش", href: orderHref(r.customerId) },
      secondary: r.phone ? { label: "تماس بگیر", href: `tel:${r.phone}` } : undefined,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.customerId - b.customerId).slice(0, limit);
}

const toFa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
