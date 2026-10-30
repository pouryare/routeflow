"use client";

import { faNum } from "@/lib/format";

type CountMode = "int" | "pct";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** A figure whose digits roll like an odometer when its value changes.
 *
 *  Drop-in for a formatted figure: `<CountUp value={d.revenue_toman} />` renders the same
 *  «۱۲٬۴۵۰٬۰۰۰» a bare `faNum` would; each digit sits in its own column and scrolls to its new
 *  value when the number changes (a filter, a new order, a payment). Under reduced motion the
 *  figure just changes. Built by hand because @number-flow/react drew no Persian digits.
 *
 *  Formatting is a `mode` + `suffix`, never a function prop — this renders inside server
 *  components (the dashboard), and a function cannot cross the server→client boundary.
 *
 *  On first view each digit also rolls up from ۰ (a CSS animation, so no client reset after the
 *  server's HTML).
 */
export default function CountUp({
  value,
  mode = "int",
  suffix = "",
}: {
  value: number;
  mode?: CountMode;
  /** Plain text appended after the figure, e.g. " مشتری". */
  suffix?: string;
}) {
  const body = mode === "pct" ? `${faNum(Math.round(value * 100))}٪` : faNum(Math.round(value));
  const chars = [...body];
  return (
    <>
      <span className="odo" dir="ltr" role="img" aria-label={body}>
        {chars.map((c, i) => {
          // Keyed from the right, so a figure that gains a digit keeps its other columns.
          const key = chars.length - i;
          const d = FA_DIGITS.indexOf(c);
          if (d < 0) return <span key={key} aria-hidden="true">{c}</span>;
          return (
            <span key={key} className="odo__col" aria-hidden="true">
              <span className="odo__strip" style={{ "--odo-d": d } as React.CSSProperties}>
                {[...FA_DIGITS].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      {suffix}
    </>
  );
}
