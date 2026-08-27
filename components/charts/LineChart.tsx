import ChartFrame from "./ChartFrame";
import LinePlot from "./LinePlot";

/** A single measure over time, right to left.
 *
 *  Deliberately one series only. Two measures on one chart means two y-scales, and a
 *  dual-axis chart lets the author decide what "crossing over" looks like by choosing
 *  the scales -- two charts side by side say the same thing without the editorial.
 *  If two series ever share a unit, this takes an array of series; it does not take a
 *  second axis.
 */
export default function LineChart({
  title,
  subtitle,
  points,
  formatValue,
  height = 120,
  width = 520,
  empty,
}: {
  title: string;
  subtitle?: string;
  /** Oldest last: index 0 is the most recent and is drawn at the right edge. */
  points: { label: string; value: number }[];
  formatValue: (v: number) => string;
  height?: number;
  width?: number;
  empty?: string;
}) {
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      empty={empty}
      rows={points.map((p) => ({ label: p.label, value: formatValue(p.value) }))}
    >
      {/* Values are formatted here, on the server, and handed down as strings. LinePlot is
          a client component and cannot receive `formatValue` -- functions do not cross that
          boundary -- and duplicating the money formatting inside it would make two places
          that decide how a figure is written. */}
      <LinePlot
        points={points.map((p) => ({ ...p, formatted: formatValue(p.value) }))}
        width={width}
        height={height}
        ariaLabel={title}
      />
    </ChartFrame>
  );
}
