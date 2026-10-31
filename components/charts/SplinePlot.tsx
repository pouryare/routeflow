"use client";

import { useRef, useState } from "react";
import { linearScale, niceTicks } from "@/lib/chartScale";
import { splinePath, areaPath, type Pt } from "@/lib/design/spline";

export interface SplineSeries {
  label: string;
  values: number[];
  /** Formatted on the server. A client component cannot be handed a formatter, and
   *  re-implementing «۱۲٬۵۰۰ تومان» here would be a second source of truth for money. */
  formatted: string[];
  /** Drawn dotted and without an area fill -- the comparison, not the measure. */
  dashed?: boolean;
  color: string;
}

const PAD = 11; // half a dot plus its stroke, so the end points are not shaved

/** The interactive half of SplineChart.
 *
 *  Split out so the "use client" boundary stays as small as it can be: the frame, the
 *  legend, the data table and the empty state all stay on the server, and only the plot
 *  -- which needs pointer events -- ships to the browser. Same arrangement as LinePlot;
 *  see the note there.
 */
export default function SplinePlot({
  series,
  labels,
  width,
  height,
  max,
  ariaLabel,
}: {
  series: SplineSeries[];
  /** Index 0 is the NEWEST reading and is drawn at the right edge -- /sales reads RTL. */
  labels: string[];
  width: number;
  height: number;
  max?: number;
  ariaLabel: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const n = labels.length;
  const highest = Math.max(max ?? 0, ...series.flatMap((s) => s.values), 0);
  const ticks = niceTicks(0, highest);
  const top = ticks[ticks.length - 1] || 1;
  const yOf = linearScale(0, top, height, 0);
  const step = n > 1 ? (width - PAD * 2) / (n - 1) : 0;
  const xOf = (i: number) => width - PAD - i * step;

  const pointsOf = (s: SplineSeries): Pt[] =>
    s.values.map((v, i) => ({ x: xOf(i), y: yOf(v) }));

  /** Nearest reading by x rather than the dots themselves: a 4.6px dot is a poor target
   *  with a mouse and an impossible one with a thumb, and a line is read by looking at a
   *  moment in time, not at a marker. */
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = wrap.current;
    if (!el || n === 0) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    /* clientX is physical and left-origin in both directions; this plot is right-to-left,
       so it is the distance from the RIGHT edge that maps onto the index. */
    const fromRight = ((r.right - e.clientX) / r.width) * width - PAD;
    const i = Math.round(fromRight / (step || 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  }

  const lead = series[0];
  const leftPct = active === null ? 0 : (xOf(active) / width) * 100;
  const topPct = active === null ? 0 : (yOf(lead.values[active]) / (height + 22)) * 100;

  return (
    <div
      ref={wrap}
      className="relative touch-pan-y"
      onPointerMove={onMove}
      onPointerLeave={() => setActive(null)}
      style={{ ["--dot-count" as string]: n }}
    >
      {/* No `height` attribute, and height:auto in the style.
          With a fixed pixel height the default preserveAspectRatio ("xMidYMid meet")
          scales the drawing to fit the SHORTER axis and centres it, so in a card wider
          than the viewBox's ratio the plot sits in a narrow column with empty margins on
          both sides. Letting the height come from the intrinsic ratio makes it fill the
          card, and keeps the dots circular -- which preserveAspectRatio="none" would not. */}
      <svg
        viewBox={`0 0 ${width} ${height + 22}`}
        width="100%"
        style={{ height: "auto" }}
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
            strokeDasharray="2 5"
          />
        ))}

        <defs>
          <linearGradient id="spline-wash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lead.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lead.color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Under the lines, so a stroke always sits on top of its own fill. */}
        {lead.values.length > 1 && (
          <path
            className="spline__area"
            d={areaPath(pointsOf(lead), height)}
            fill="url(#spline-wash)"
            stroke="none"
          />
        )}

        {series.map((s) => (
          <path
            key={s.label}
            /* The dash pattern lives in CSS, not on the element. `.spline__line` sets
               stroke-dasharray for its draw-on animation, and a CSS declaration beats a
               presentation attribute -- so a strokeDasharray prop here would be
               overridden and the comparison would render solid. */
            className={`spline__line${s.dashed ? " spline__line--dashed" : ""}`}
            pathLength={1}
            d={splinePath(pointsOf(s))}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 2 : 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Only the lead series gets dots. A second set doubles the marks on the plot and
            the comparison stops reading as background. */}
        {lead.values.map((v, i) => (
          <circle
            key={labels[i] ?? i}
            className="dot-p"
            cx={xOf(i)}
            cy={yOf(v)}
            r={4.6}
            fill="var(--surface)"
            stroke={lead.color}
            strokeWidth={2.2}
            style={{ ["--dot-i" as string]: i }}
          />
        ))}

        {active !== null && (
          <>
            <line
              x1={xOf(active)}
              x2={xOf(active)}
              y1={yOf(lead.values[active])}
              y2={height}
              stroke={lead.color}
              strokeWidth={1}
              opacity={0.4}
            />
            <circle
              cx={xOf(active)}
              cy={yOf(lead.values[active])}
              r={6}
              fill={lead.color}
              stroke="var(--surface)"
              strokeWidth={2.4}
            />
          </>
        )}

        {/* direction: ltr on the labels, and it is load-bearing.
            `text-anchor` resolves against the INLINE direction, so under the page's rtl
            an anchor of "end" extends the box to the RIGHT and "start" extends it LEFT --
            both off the viewBox, which clips them. Measured: end@x=509 ran 509->551 in a
            520-wide box. Forcing ltr makes start/end physical again, and a year/month/day
            date is an ltr run anyway; the isolate keeps it from disturbing its
            surroundings. */}
        {n > 0 && (
          <>
            <text
              x={width - PAD}
              y={height + 16}
              textAnchor="end"
              className="fill-[var(--text-muted)]"
              style={{ fontSize: 10, direction: "ltr", unicodeBidi: "isolate" }}
            >
              {labels[0]}
            </text>
            <text
              x={PAD}
              y={height + 16}
              textAnchor="start"
              className="fill-[var(--text-muted)]"
              style={{ fontSize: 10, direction: "ltr", unicodeBidi: "isolate" }}
            >
              {labels[n - 1]}
            </text>
          </>
        )}
      </svg>

      {active !== null && (
        <div
          className="chart-pill"
          style={{ left: `${leftPct}%`, top: `${topPct}%` }}
          role="status"
          aria-live="off"
        >
          <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {labels[active]}
          </span>
          {series.map((s) => (
            <span key={s.label} className="block text-[length:var(--text-sm)]">
              {series.length > 1 && (
                <span className="text-[var(--text-muted)]">{s.label} </span>
              )}
              <span className="num text-[var(--text)]">{s.formatted[active]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
