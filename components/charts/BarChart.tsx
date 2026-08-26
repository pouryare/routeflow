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
  empty?: string;
}) {
  const values = data.map((d) => d.value);
  const bars = barLayout(values, width, height);
  const centres = barCentres(data.length, width);
  const ticks = niceTicks(0, Math.max(...values, 0));
  const yOf = linearScale(0, ticks[ticks.length - 1], height, 0);

  const colorAt = (i: number) => data[i].color ?? (colorful ? seriesColor(i) : SINGLE_SERIES_COLOR);

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      empty={empty}
      rows={data.map((d) => ({ label: d.label, value: formatValue(d.value) }))}
      legend={colorful ? data.map((d, i) => ({ label: d.label, color: colorAt(i) })) : undefined}
    >
      <svg
        viewBox={`0 0 ${width} ${height + 26}`}
        width="100%"
        height={height + 26}
        role="img"
        aria-label={title}
        className="max-w-full"
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
              className="transition-[filter] duration-[var(--dur-fast)] hover:brightness-125"
            />
          </g>
        ))}

        {centres.map((cx, i) => (
          <text
            key={data[i].label}
            x={cx}
            y={height + 16}
            textAnchor="middle"
            className="fill-[var(--text-faint)] text-[length:var(--text-xs)]"
            style={{ fontSize: 10 }}
          >
            {data[i].label.length > 10 ? `${data[i].label.slice(0, 9)}…` : data[i].label}
          </text>
        ))}
      </svg>
    </ChartFrame>
  );
}
