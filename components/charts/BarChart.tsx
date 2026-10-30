import { barLayout, barCentres, niceTicks, linearScale } from "@/lib/chartScale";
import { SINGLE_SERIES_COLOR, seriesColor } from "@/lib/chartPalette";
import ChartFrame from "./ChartFrame";

export interface BarDatum {
  label: string;
  value: number;
  /** Overrides the palette -- only for bars that mean a status (coverage, debt band). */
  color?: string;
}

/** A bar chart, rendered on the server as static SVG.
 *
 *  Bars read right to left, because the page is RTL: the first category sits at the
 *  right edge and time runs leftward. Getting that backwards does not look wrong, it
 *  reverses the trend, which is why it is settled once in barLayout rather than per chart.
 *
 *  One series wears the app accent. Several wear the validated categorical order -- see
 *  chartPalette.ts for why that order is not adjustable.
 */
export default function BarChart({
  title,
  subtitle,
  data,
  formatValue,
  height = 140,
  width = 520,
  colorful = false,
  barLabel,
  max,
  empty,
}: {
  title: string;
  subtitle?: string;
  data: BarDatum[];
  /** How a value reads in the tooltip and the table -- faToman, faNum, «۳ سفارش». */
  formatValue: (v: number) => string;
  height?: number;
  width?: number;
  /** Give each bar its own hue. Off by default: one measure is one series. */
  colorful?: boolean;
  /** Draws the value above each bar. Give it a compact form -- «۹۵٪», «۱٫۲م» -- not the
   *  full «۳۷٬۲۶۵٬۰۰۰ تومان», which will not fit and will collide with its neighbour.
   *  Omitted means no labels, which is right for a dense series. */
  barLabel?: (value: number) => string;
  /** Fixes the top of the scale. Without it a chart scales to its own largest bar, so
   *  95% and 100% render almost the same height and the difference vanishes. Set it for
   *  anything measured against a known ceiling. */
  max?: number;
  empty?: string;
}) {
  const values = data.map((d) => d.value);
  // Padding the series with the ceiling makes barLayout scale to it without needing
  // a second code path: the extra value is never drawn.
  const bars = barLayout(max === undefined ? values : [...values, max], width, height).slice(
    0,
    values.length
  );
  // Same slot count as barLayout saw, or the labels drift out from under their bars.
  const centres = barCentres(max === undefined ? data.length : data.length + 1, width);
  const ticks = niceTicks(0, Math.max(...values, max ?? 0, 0));
  const yOf = linearScale(0, ticks[ticks.length - 1], height, 0);

  const colorAt = (i: number) => data[i].color ?? (colorful ? seriesColor(i) : SINGLE_SERIES_COLOR);

  // Headroom above the plot for the value labels. The tallest bar reaches y = 0, so
  // without this its label is clamped onto the bar and reads as printed on top of it.
  // Extending the viewBox upward rather than shrinking the bars keeps every bar the
  // same height it would have had, so charts with and without labels stay comparable.
  const headroom = barLabel ? 14 : 0;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      empty={empty}
      rows={data.map((d) => ({ label: d.label, value: formatValue(d.value) }))}
      /* No legend: every bar is labelled directly on the axis beneath it, so identity
         is carried by position and text rather than by colour alone -- which is what a
         legend is there to guarantee. Repeating the same names underneath is noise. */
    >
      <svg
        viewBox={`0 ${-headroom} ${width} ${height + 26 + headroom}`}
        width="100%"
        height={height + 26 + headroom}
        role="img"
        aria-label={title}
        className="bars max-w-full"
      >
        {/* Grid first, so the bars sit over it. Recessive on purpose: it is a reading
            aid, not data. */}
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

        {bars.map((bar, i) => (
          <g key={data[i].label}>
            <title>{`${data[i].label}: ${formatValue(data[i].value)}`}</title>
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={4}
              fill={colorAt(i)}
              className="chart-rise transition-[filter] duration-[var(--dur-fast)] hover:brightness-125"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            />
          </g>
        ))}

        {barLabel &&
          bars.map((bar, i) => (
            <text
              key={`v-${data[i].label}`}
              x={bar.x + bar.width / 2}
              y={bar.y - 5}
              textAnchor="middle"
              className="fill-[var(--text-muted)] tabular-nums"
              style={{ fontSize: 10 }}
            >
              {barLabel(data[i].value)}
            </text>
          ))}

        {data.map((datum, i) => (
          <text
            key={datum.label}
            x={centres[i]}
            y={height + 16}
            textAnchor="middle"
            className="fill-[var(--text-muted)] text-[length:var(--text-xs)]"
            style={{ fontSize: 10 }}
          >
            {datum.label.length > 10 ? `${datum.label.slice(0, 9)}…` : datum.label}
          </text>
        ))}
      </svg>
    </ChartFrame>
  );
}
