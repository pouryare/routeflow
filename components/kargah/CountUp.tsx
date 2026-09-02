"use client";

import { faNum } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

type CountMode = "int" | "pct";

/** A number that counts up to its value the first time it is seen.
 *
 *  Drop-in for a formatted figure: `<CountUp value={d.revenue_toman} />` renders the same
 *  «۱۲٬۴۵۰٬۰۰۰» a bare `faNum` would, having briefly swept up to it. Under reduced motion
 *  (or on the server) it is the final figure with no sweep.
 *
 *  Formatting is a `mode` + `suffix`, never a function prop — this renders inside server
 *  components (the dashboard), and a function cannot cross the server→client boundary.
 */
export default function CountUp({
  value,
  mode = "int",
  suffix = "",
  durationMs,
}: {
  value: number;
  mode?: CountMode;
  /** Plain text appended after the figure, e.g. " مشتری". */
  suffix?: string;
  durationMs?: number;
}) {
  const shown = useCountUp(value, durationMs ? { durationMs } : undefined);
  const body = mode === "pct" ? `${faNum(Math.round(shown * 100))}٪` : faNum(Math.round(shown));
  return <>{body + suffix}</>;
}
