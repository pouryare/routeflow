import { smoothLinePath } from "@/lib/chartScale";
import { SINGLE_SERIES_COLOR } from "@/lib/chartPalette";

/** A number's direction, at almost no cost: one smoothed line, no axis, no labels.
 *
 *  One component so every sparkline in the app draws the same way (StatCard, the KPI bar).
 *  `values` are OLDEST LAST, like LineChart, and smoothLinePath puts index 0 at the right
 *  edge: the newest reading sits at the start edge of an RTL page, where the reader
 *  begins, and a sparkline that ran the other way would contradict every chart beside it.
 *  `null` is a period with no reading: it is dropped, not drawn as zero, because "not
 *  computed" is not "none". Fewer than two readings draws nothing. */
export default function Sparkline({
  values,
  height = 28,
  width = 120,
  stroke = SINGLE_SERIES_COLOR,
  area = false,
  className = "",
}: {
  values: (number | null)[];
  height?: number;
  width?: number;
  stroke?: string;
  /** Fill under the line: for the one hero figure, not for a row of small ones. */
  area?: boolean;
  className?: string;
}) {
  const points = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length < 2) return null;
  const line = smoothLinePath(points, width, height - 4);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={`sparkline block ${className}`.trim()}
      aria-hidden
    >
      {area ? (
        /* The line runs right to left, so it ends at the left edge: close down the left
           side, along the bottom, and back up the right. */
        <path d={`${line} L 0 ${height} L ${width} ${height} Z`} fill={stroke} opacity={0.12} stroke="none" />
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.85}
      />
    </svg>
  );
}
