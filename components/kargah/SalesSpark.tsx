"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SparkPoint {
  /** Axis label under the point. */
  label: string;
  /** This period's value, in the chart's own unit (millions of toman). */
  a: number;
  /** The comparison period, same unit. */
  b: number;
  /** The tooltip's headline, formatted on the server — a client component cannot be
   *  handed a formatter, and re-implementing «۱۲٫۴ میلیون» here would be a second source
   *  of truth for how a figure is written. */
  aLabel: string;
  /** The tooltip's second line. */
  sub: string;
}

/* The artifact's exact geometry. These are not round numbers by accident: the viewBox,
   the padding and the baseline are what its gridlines and label positions were drawn
   against, so changing one moves the whole picture. */
const W = 720;
const PAD = 30;
const TOP = 14;
const BOT = 212;

/** Catmull-Rom through the points, converted to cubic béziers — a real smooth curve
 *  rather than a polyline pretending to be one. */
function spline(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** The dashboard's sales curve (the artifact's `#spark`).
 *
 *  The line draws itself, the fill and the comparison series fade up behind it, then the
 *  points land one at a time. Replays on mount, which is when a page is navigated into.
 */
export default function SalesSpark({
  points,
  max,
  ariaLabel,
}: {
  /** Index 0 is the OLDEST reading. RTL puts it on the right — see X(). */
  points: SparkPoint[];
  max: number;
  ariaLabel: string;
}) {
  const lineA = useRef<SVGPathElement | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const n = points.length;
  const step = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  /* RTL: the oldest reading sits on the RIGHT, so x decreases as the index grows. */
  const X = useCallback((i: number) => W - PAD - i * step, [step]);
  const Y = useCallback((v: number) => BOT - (v / max) * (BOT - TOP), [max]);

  const ptsA = points.map((p, i) => [X(i), Y(p.a)] as [number, number]);
  const ptsB = points.map((p, i) => [X(i), Y(p.b)] as [number, number]);
  const dA = spline(ptsA);
  const dB = spline(ptsB);
  const area = dA ? `${dA} L ${X(n - 1)} ${BOT} L ${X(0)} ${BOT} Z` : "";
  const ticks = [max * 0.25, max * 0.5, max * 0.75, max];

  useEffect(() => {
    const a = lineA.current;
    if (!a) return;
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dots = Array.from(
      a.ownerSVGElement?.querySelectorAll<SVGCircleElement>(".dot-p") ?? []
    );
    const fill = a.ownerSVGElement?.querySelector(".fill-a");
    const cmp = a.ownerSVGElement?.querySelector(".ser-b");

    if (reduced) {
      a.style.strokeDasharray = "";
      a.style.strokeDashoffset = "";
      fill?.classList.add("in");
      cmp?.classList.add("in");
      dots.forEach((c) => c.classList.add("in"));
      return;
    }

    const L = a.getTotalLength();
    fill?.classList.remove("in");
    cmp?.classList.remove("in");
    for (const c of dots) {
      c.classList.remove("in");
      /* transition:none for the reset. A 0s transition that still carries a DELAY holds
         the old value for the length of that delay, so leaving the stagger on here
         postpones the reset past the moment it is switched back on. */
      c.style.transition = "none";
      c.style.transitionDelay = "";
    }
    a.style.transition = "none";
    a.style.strokeDasharray = `${L} ${L}`;
    a.style.strokeDashoffset = String(L);
    /* A class removed and re-added inside one style batch is not a change the browser can
       transition FROM — it never computed the start value. Reading a layout property
       forces that computation before animating away from it. */
    void document.body.offsetHeight;
    a.style.transition = "";
    a.style.strokeDashoffset = "0";
    fill?.classList.add("in");
    cmp?.classList.add("in");
    dots.forEach((c, i) => {
      c.style.transition = "";
      c.style.transitionDelay = `${420 + i * 90}ms`;
      c.classList.add("in");
    });
  }, [dA]);

  function onPoint(i: number) {
    const svg = svgRef.current;
    const box = boxRef.current;
    if (!svg || !box) return;
    const sr = svg.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const k = sr.width / W; // the svg scales; px = svgUnits × k
    setTipPos({ x: sr.left - br.left + X(i) * k, y: sr.top - br.top + Y(points[i].a) * k });
    setActive(i);
  }

  const on = active !== null ? points[active] : null;

  return (
    <div className="chartbox" ref={boxRef}>
      <div className={`tip${on ? " on" : ""}`} style={{ left: tipPos.x, top: tipPos.y }}>
        <b>{on ? on.aLabel : "—"}</b>
        <span className="s">{on ? on.sub : "—"}</span>
      </div>
      <svg
        className="spark"
        ref={svgRef}
        viewBox={`0 0 ${W} 268`}
        role="img"
        aria-label={ariaLabel}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
            <stop className="gA-stop" offset="0%" stopOpacity=".20" />
            <stop className="gA-stop" offset="100%" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g>
          {ticks.map((v) => (
            <line
              key={v}
              className="grid-l"
              x1={PAD - 8}
              x2={W - PAD + 8}
              y1={Y(v)}
              y2={Y(v)}
            />
          ))}
        </g>
        <path className="fill-a" d={area} fill="url(#gA)" />
        <path className="ser-b" d={dB} />
        <path className="ser-a" ref={lineA} d={dA} />
        {active !== null && (
          <>
            <line className="vline on" x1={X(active)} x2={X(active)} y1={8} y2={BOT} />
            <circle className="pt on" r={6.5} cx={X(active)} cy={Y(points[active].a)} />
          </>
        )}
        <g>
          {points.map((p, i) => (
            <text key={p.label} className="xl" x={X(i)} y={242} textAnchor="middle">
              {p.label}
            </text>
          ))}
        </g>
        <g>
          {points.map((p, i) => (
            <circle key={p.label} className="dot-p" cx={X(i)} cy={Y(p.a)} />
          ))}
        </g>
        <g>
          {points.map((p, i) => (
            <rect
              key={p.label}
              className="hit"
              x={X(i) - step / 2}
              y={0}
              width={step}
              height={BOT + 20}
              onPointerMove={() => onPoint(i)}
              onPointerDown={() => onPoint(i)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
