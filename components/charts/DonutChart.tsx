import { donutArcs } from "@/lib/chartScale";
import { seriesColor, foldTail } from "@/lib/chartPalette";
import ChartFrame from "./ChartFrame";
import { faNum } from "@/lib/format";

/** Composition -- how a total splits. Debt by age, revenue by product, orders by status.
 *
 *  A donut rather than a pie because the hole holds the total, which is the number
 *  people actually want and would otherwise sit in a caption. Anything past the seventh
 *  slice folds into «سایر» rather than cycling the palette, so two slices can never end
 *  up the same colour.
 */
export default function DonutChart({
  title,
  subtitle,
  data,
  formatValue,
  centreLabel,
  size = 160,
  thickness = 22,
  empty,
}: {
  title: string;
  subtitle?: string;
  data: { label: string; value: number; color?: string }[];
  formatValue: (v: number) => string;
  /** What the hole says under the total, e.g. «تومان» or «سفارش». */
  centreLabel?: string;
  size?: number;
  thickness?: number;
  empty?: string;
}) {
  const folded = foldTail(
    data,
    (d) => d.value,
    (d) => d.label
  );
  const explicit = new Map(data.map((d) => [d.label, d.color]));
  const colorAt = (label: string, i: number) => explicit.get(label) ?? seriesColor(i);

  const radius = size / 2;
  const arcs = donutArcs(
    folded.map((f) => f.value),
    radius,
    thickness
  );
  const total = folded.reduce((a, f) => a + f.value, 0);

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      empty={empty}
      rows={folded.map((f) => ({ label: f.label, value: formatValue(f.value) }))}
      legend={folded.map((f, i) => ({
        label: f.label,
        color: colorAt(f.label, i),
        value: `${faNum(Math.round((f.value / (total || 1)) * 100))}٪`,
      }))}
    >
      <div className="flex justify-center">
        <svg
          viewBox={`${-radius} ${-radius} ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={title}
        >
          {arcs.map((arc) => {
            const slice = folded[arc.index];
            return (
              <g key={slice.label}>
                <title>{`${slice.label}: ${formatValue(slice.value)}`}</title>
                <path
                  d={arc.d}
                  fill={colorAt(slice.label, arc.index)}
                  /* A 2px ring in the surface colour separates adjacent slices, so two
                     similar hues never touch edge to edge. */
                  stroke="var(--surface)"
                  strokeWidth={2}
                  className="transition-[filter] duration-[var(--dur-fast)] hover:brightness-125"
                />
              </g>
            );
          })}

          <text
            x={0}
            y={centreLabel ? -2 : 5}
            textAnchor="middle"
            className="fill-[var(--text)] tabular-nums"
            style={{ fontSize: 16, fontWeight: 500 }}
          >
            {formatValue(total)}
          </text>
          {centreLabel && (
            <text
              x={0}
              y={14}
              textAnchor="middle"
              className="fill-[var(--text-muted)]"
              style={{ fontSize: 10 }}
            >
              {centreLabel}
            </text>
          )}
        </svg>
      </div>
    </ChartFrame>
  );
}
