/** The "Why?" delta decomposition — a pure module, no `db` import.
 *
 *  Source §5: *Sales ↓12% → by territory → by salesperson → by funnel stage → "the
 *  drop is in Samples, not Conversion."* `explainDelta` is one rung of that ladder:
 *  given the same metric bucketed one way in two periods, it says which bucket moved
 *  the number and by how much of the total move.
 */

export interface Contribution {
  key: string;
  label: string;
  before: number;
  after: number;
  /** after − before */
  delta: number;
  /** delta / (total after − total before); 0 when the total did not move */
  share: number;
}

export interface DeltaExplanation {
  total_before: number;
  total_after: number;
  /** total_after − total_before */
  delta: number;
  /** delta / total_before; 0 when total_before is 0 */
  pct: number;
  /** every bucket, sorted by |delta| descending */
  contributions: Contribution[];
  /** a sentence naming contributions[0] */
  headline: string;
}

export function explainDelta(
  before: Record<string, number>,
  after: Record<string, number>,
  labels: Record<string, string> = {}
): DeltaExplanation {
  const totalBefore = Object.values(before).reduce((s, v) => s + v, 0);
  const totalAfter = Object.values(after).reduce((s, v) => s + v, 0);
  const totalDelta = totalAfter - totalBefore;

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const contributions: Contribution[] = keys
    .map((key) => {
      const b = before[key] ?? 0;
      const a = after[key] ?? 0;
      const delta = a - b;
      return {
        key,
        label: labels[key] ?? key,
        before: b,
        after: a,
        delta,
        share: totalDelta === 0 ? 0 : delta / totalDelta,
      };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const top = contributions[0];
  let headline: string;
  if (!top || top.delta === 0) {
    headline = "تغییری در این دوره ثبت نشده";
  } else if (totalDelta === 0) {
    headline = `جمع کل ثابت مانده؛ جابه‌جایی بین «${top.label}» و بقیه`;
  } else if (top.delta < 0) {
    headline = `بیشترین افت از «${top.label}» است`;
  } else {
    headline = `بیشترین رشد از «${top.label}» است`;
  }

  return {
    total_before: totalBefore,
    total_after: totalAfter,
    delta: totalDelta,
    pct: totalBefore === 0 ? 0 : totalDelta / totalBefore,
    contributions,
    headline,
  };
}
