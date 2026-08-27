import ChartFrame from "./ChartFrame";
import SplinePlot, { type SplineSeries } from "./SplinePlot";

export interface SplineInput {
  label: string;
  values: number[];
  dashed?: boolean;
  color?: string;
}

/** A measure over time as a real curve (MASTER.md, "Spline chart").
 *
 *  Wrapped in ChartFrame so the legend, the `<details>` data table and the empty state
 *  are not re-decided one chart at a time -- see the note there.
 *
 *  Unlike LineChart this accepts more than one series, but only ever on ONE scale: the
 *  extra series is a comparison in the same unit (a moving average, the same measure a
 *  month earlier), drawn dotted. It still does not take a second axis, for the reason
 *  LineChart gives.
 */
export default function SplineChart({
  title,
  subtitle,
  labels,
  series,
  formatValue,
  max,
  height = 132,
  width = 520,
  empty,
}: {
  title: string;
  subtitle?: string;
  /** Index 0 is the newest reading; it is drawn at the RIGHT edge. */
  labels: string[];
  series: SplineInput[];
  formatValue: (v: number) => string;
  max?: number;
  height?: number;
  width?: number;
  empty?: string;
}) {
  const lead = series[0];
  const isEmpty = !lead || lead.values.length === 0;

  const prepared: SplineSeries[] = series.map((s, i) => ({
    label: s.label,
    values: s.values,
    // Formatted here, on the server: SplinePlot is a client component and cannot be
    // handed `formatValue`.
    formatted: s.values.map(formatValue),
    dashed: s.dashed,
    color: s.color ?? (i === 0 ? "var(--series-single)" : "var(--series-compare)"),
  }));

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      empty={empty}
      legend={prepared.map((s) => ({ label: s.label, color: s.color }))}
      rows={
        isEmpty
          ? []
          : labels.map((label, i) => ({ label, value: formatValue(lead.values[i]) }))
      }
    >
      {isEmpty ? null : (
        <SplinePlot
          series={prepared}
          labels={labels}
          width={width}
          height={height}
          max={max}
          ariaLabel={title}
        />
      )}
    </ChartFrame>
  );
}
