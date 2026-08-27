"use client";

import { useState } from "react";
import { faNum } from "@/lib/format";

/** The month grid — the artifact's `.calgrid`.
 *
 *  A client component only because a day can be selected. The Persian week starts on
 *  شنبه, which is why the header row is ش…ج rather than a rotation of a Gregorian one.
 */
export default function ScheduleMonth({
  today,
  marks,
  days = 31,
}: {
  /** Day-of-month that is today, so it can wear the accent. */
  today: number;
  /** Day-of-month → the dot colours for that day. */
  marks: Record<number, string[]>;
  days?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const dow = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  return (
    <div className="calgrid">
      {dow.map((d) => (
        <div className="dow" key={d}>
          {d}
        </div>
      ))}
      {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
        <button
          key={d}
          type="button"
          className={`day${d === today ? " today" : ""}${sel === d && d !== today ? " sel" : ""}`}
          onClick={() => setSel(d)}
          aria-current={d === today ? "date" : undefined}
        >
          <span>{faNum(d)}</span>
          <span className="dots">
            {(marks[d] ?? []).slice(0, 3).map((c, k) => (
              <i key={k} style={{ background: c }} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
