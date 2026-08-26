import { linePath, niceTicks, linearScale } from "@/lib/chartScale";
import { SINGLE_SERIES_COLOR } from "@/lib/chartPalette";
import ChartFrame from "./ChartFrame";

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
  const values = points.map((p) => p.value);
  const d = linePath(values, width, height);
  const max = Math.max(...values, 0);
  const ticks = niceTicks(0, max);
  const yOf = linearScale(Math.min(...values, 0), max, height, 0);
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      empty={empty}
      rows={points.map((p) => ({ label: p.label, value: formatValue(p.value) }))}
    >
      <svg
        viewBox={`0 0 ${width} ${height + 20}`}
        width="100%"
        height={height + 20}
        role="img"
        aria-label={title}
        className="max-w-full"
      >
        {ticks.map((t) => (
          <line
            key={t}
            x1={0}
            x2={width}
            y1={yOf(t)}
            y2={yOf(t)}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}

        <path
          d={d}
          fill="none"
          stroke={SINGLE_SERIES_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Markers carry the tooltip, so the hit target is the dot rather than the
            hairline of the path. Hidden when the series is long enough that dots would
            merge into a bead chain. */}
        {points.length <= 40 &&
          points.map((p, i) => (
            <g key={`${p.label}-${i}`}>
              <title>{`${p.label}: ${formatValue(p.value)}`}</title>
              <circle
                cx={width - i * step}
                cy={yOf(p.value)}
                r={4}
                fill={SINGLE_SERIES_COLOR}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </g>
          ))}

        {points.length > 0 && (
          <>
            <text
              x={width}
              y={height + 14}
              textAnchor="end"
              className="fill-[var(--text-faint)]"
              style={{ fontSize: 10 }}
            >
              {points[0].label}
            </text>
            <text
              x={0}
              y={height + 14}
              textAnchor="start"
              className="fill-[var(--text-faint)]"
              style={{ fontSize: 10 }}
            >
              {points[points.length - 1].label}
            </text>
          </>
        )}
      </svg>
    </ChartFrame>
  );
}
