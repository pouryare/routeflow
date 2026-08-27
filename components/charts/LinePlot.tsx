"use client";

import { useRef, useState } from "react";
import { linearScale, niceTicks, smoothLinePath } from "@/lib/chartScale";
import { SINGLE_SERIES_COLOR } from "@/lib/chartPalette";

export interface PlotPoint {
  label: string;
  value: number;
  /** Formatted on the server. A client component cannot be handed a formatter function,
   *  and re-implementing «۱۲٬۵۰۰ تومان» here would be a second source of truth for how
   *  money is written. */
  formatted: string;
}

/** The interactive half of LineChart.
 *
 *  Split out purely so the "use client" boundary is as small as it can be: the frame, the
 *  legend, the data table and the empty state all stay on the server, and only the plot --
 *  which needs pointer events -- ships to the browser.
 */
export default function LinePlot({
  points,
  width,
  height,
  ariaLabel,
}: {
  points: PlotPoint[];
  width: number;
  height: number;
  ariaLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const yOf = linearScale(min, max, height, 0);
  const ticks = niceTicks(0, max);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const xOf = (i: number) => width - i * step;

  /** Nearest point by x, rather than hovering the dots themselves.
   *
   *  A 4px dot is a poor target with a mouse and an impossible one with a thumb. Reading
   *  the whole plot width and snapping to the closest reading means the chart answers
   *  anywhere along it, which is also how someone actually reads a line -- by looking at
   *  a moment in time, not at a marker.
   */
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = wrapRef.current;
    if (!el || points.length === 0) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    // clientX is physical and left-origin in both directions; the plot is right-to-left,
    // so the distance from the RIGHT edge is what maps onto the index.
    const fromRight = ((r.right - e.clientX) / r.width) * width;
    const i = Math.round(fromRight / (step || 1));
    setActive(Math.min(points.length - 1, Math.max(0, i)));
  }

  const p = active === null ? null : points[active];
  // Percentages, so the pill stays pinned to its reading when the SVG scales.
  const leftPct = active === null ? 0 : (xOf(active) / width) * 100;
  const topPct = p === null ? 0 : (yOf(p.value) / (height + 20)) * 100;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerMove={onMove}
      onPointerLeave={() => setActive(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height + 20}`}
        width="100%"
        height={height + 20}
        role="img"
        aria-label={ariaLabel}
        className="block max-w-full"
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
            strokeDasharray="2 4"
          />
        ))}

        {/* Drawn under the line so the stroke always sits on top of its own fill. */}
        {points.length > 2 && (
          <>
            <defs>
              <linearGradient id="line-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SINGLE_SERIES_COLOR} stopOpacity="0.18" />
                <stop offset="100%" stopColor={SINGLE_SERIES_COLOR} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`${smoothLinePath(values, width, height)} L 0 ${height} L ${width} ${height} Z`}
              fill="url(#line-fill)"
              stroke="none"
            />
          </>
        )}

        <path
          d={smoothLinePath(values, width, height)}
          fill="none"
          stroke={SINGLE_SERIES_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active !== null && p && (
          <>
            <line
              x1={xOf(active)}
              x2={xOf(active)}
              y1={yOf(p.value)}
              y2={height}
              stroke={SINGLE_SERIES_COLOR}
              strokeWidth={1}
              opacity={0.45}
            />
            <circle
              cx={xOf(active)}
              cy={yOf(p.value)}
              r={5}
              fill={SINGLE_SERIES_COLOR}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </>
        )}

        {points.length > 0 && (
          <>
            <text x={width} y={height + 14} textAnchor="end" className="fill-[var(--text-faint)]" style={{ fontSize: 10 }}>
              {points[0].label}
            </text>
            <text x={0} y={height + 14} textAnchor="start" className="fill-[var(--text-faint)]" style={{ fontSize: 10 }}>
              {points[points.length - 1].label}
            </text>
          </>
        )}
      </svg>

      {p && (
        <div
          className="chart-pill"
          style={{ left: `${leftPct}%`, top: `${topPct}%` }}
          role="status"
          aria-live="off"
        >
          <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">{p.label}</span>
          <span className="block font-mono text-[length:var(--text-sm)] text-[var(--text)]">
            {p.formatted}
          </span>
        </div>
      )}
    </div>
  );
}
