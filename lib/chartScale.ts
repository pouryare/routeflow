/** The arithmetic behind the charts.
 *
 *  Separated from the components on purpose. Every way a chart goes wrong is arithmetic
 *  -- a division by zero on a flat series, a NaN in a path attribute that makes the whole
 *  SVG vanish silently, a single-category donut drawn as a 360-degree arc that renders as
 *  nothing. None of that is visible in a component test that only asserts an element
 *  exists, and all of it is trivial to test here.
 *
 *  No dependency, and none wanted. Recharts is roughly half a megabyte of client bundle
 *  for six shapes on a page that is read on a phone, and these charts are rendered on the
 *  server into static SVG -- there is no client JavaScript involved at all.
 *
 *  The page is RTL, so a series reads right to left: the first category sits on the right
 *  and time runs leftward. Getting that wrong is not a cosmetic bug, it inverts a trend.
 */

/** Tick values that a person would have chosen: 0, 25, 50 rather than 0, 23.7, 47.4.
 *
 *  Always returns at least two, and always spans the data -- a flat series (an empty
 *  month, one product) would otherwise produce a single tick and a zero-height axis. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return min === 0 ? [0, 1] : [min, min + Math.abs(min) / 2];

  const rawStep = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const niceStep =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) *
    magnitude;

  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  // Accumulating with += would drift on a fractional step and produce 0.30000000000000004
  // as an axis label; multiplying from the index does not.
  for (let i = 0; start + i * niceStep <= end + niceStep / 1e6; i++) {
    ticks.push(Number((start + i * niceStep).toPrecision(12)));
  }
  return ticks;
}

/** Maps a value from a data domain onto a pixel range. Range reversed (r0 > r1) is the
 *  usual case for a y-axis, because SVG's y grows downward and a chart grows upward. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export interface DonutArc {
  d: string;
  fraction: number;
  index: number;
}

/** Ring segments, starting at twelve o'clock and running clockwise.
 *
 *  Zero-valued slices are dropped rather than emitted as an empty path, and a single
 *  category is drawn as two half-arcs -- an SVG arc of exactly 360 degrees has its start
 *  and end point in the same place and renders as nothing at all, which would turn "all
 *  of the revenue came from one product" into a blank circle. */
export function donutArcs(values: number[], radius: number, thickness: number): DonutArc[] {
  const total = values.reduce((a, v) => a + (v > 0 ? v : 0), 0);
  if (total <= 0) return [];

  const inner = radius - thickness;
  const point = (r: number, angle: number) => {
    const a = angle - Math.PI / 2; // 0 rad at twelve o'clock rather than three
    return [r * Math.cos(a), r * Math.sin(a)] as const;
  };

  const arcs: DonutArc[] = [];
  let start = 0;

  values.forEach((value, index) => {
    if (!(value > 0)) return;
    const fraction = value / total;

    if (fraction >= 1) {
      // Two half circles, because one full arc is degenerate.
      const [ox, oy] = point(radius, 0);
      const [obx, oby] = point(radius, Math.PI);
      const [ix, iy] = point(inner, 0);
      const [ibx, iby] = point(inner, Math.PI);
      arcs.push({
        index,
        fraction: 1,
        d:
          `M ${ox} ${oy} A ${radius} ${radius} 0 0 1 ${obx} ${oby}` +
          ` A ${radius} ${radius} 0 0 1 ${ox} ${oy}` +
          ` M ${ix} ${iy} A ${inner} ${inner} 0 0 0 ${ibx} ${iby}` +
          ` A ${inner} ${inner} 0 0 0 ${ix} ${iy} Z`,
      });
      return;
    }

    const end = start + fraction * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    const [x0, y0] = point(radius, start);
    const [x1, y1] = point(radius, end);
    const [x2, y2] = point(inner, end);
    const [x3, y3] = point(inner, start);

    arcs.push({
      index,
      fraction,
      d:
        `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1}` +
        ` L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`,
    });
    start = end;
  });

  return arcs;
}

/** An SVG path across a series, laid out right to left.
 *
 *  A single point becomes a degenerate line to itself, so the marker still shows -- one
 *  data point is what a chart looks like on the first day anything is recorded. */
export function linePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";

  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const y = linearScale(min, max, height, 0);
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    // Right to left: index 0 sits at the right edge.
    const px = width - i * step;
    return `${px.toFixed(2)} ${y(v).toFixed(2)}`;
  });

  if (points.length === 1) return `M ${points[0]} L ${points[0]}`;
  return `M ${points[0]} ` + points.slice(1).map((p) => `L ${p}`).join(" ");
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

/** Bars across a width, tallest equal to the full height, first on the right. */
export function barLayout(values: number[], width: number, height: number, gap = 4): Bar[] {
  if (values.length === 0) return [];

  const max = Math.max(...values, 0);
  const slot = width / values.length;
  const barWidth = Math.max(1, slot - gap);

  return values.map((v, i) => {
    // max === 0 means every bar is zero; without the guard this is 0/0.
    const h = max > 0 ? Math.max(0, (v / max) * height) : 0;
    return {
      index: i,
      x: width - (i + 1) * slot + gap / 2,
      y: height - h,
      width: barWidth,
      height: h,
    };
  });
}

/** Evenly spaced label positions matching barLayout, for an axis underneath. */
export function barCentres(count: number, width: number): number[] {
  const slot = width / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => width - (i + 0.5) * slot);
}
