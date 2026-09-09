import { SkeletonBlock, SkeletonLabel, SkeletonRows } from "@/components/Skeleton";

/** The body of a route's loading state, shaped like the page that is coming.
 *
 *  Five shapes rather than thirty-four bespoke files. A skeleton's job is to reserve the
 *  right amount of space in roughly the right arrangement so nothing jumps when the data
 *  lands; past that, detail is cost without benefit — and thirty-four hand-drawn
 *  skeletons is thirty-four more things to drift out of sync with their pages.
 *
 *  Server component: no state, no effects.
 */
export type PageShape = "rows" | "grid" | "board" | "chart" | "form";

export default function PageSkeleton({ shape = "rows" }: { shape?: PageShape }) {
  return (
    <>
      <SkeletonLabel />
      <div aria-hidden="true">{body(shape)}</div>
    </>
  );
}

function body(shape: PageShape) {
  switch (shape) {
    /* Stat tiles over a chart: dashboards and day views. */
    case "grid":
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} className="h-24 rounded-[var(--r-lg)]" />
            ))}
          </div>
          <SkeletonBlock className="h-64 rounded-[var(--r-2xl)]" />
        </div>
      );
    /* Columns of cards: the assignment board, the order pipeline, run lanes. */
    case "board":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, c) => (
            <div key={c} className="flex flex-col gap-2">
              <SkeletonBlock className="h-7 w-28 rounded-[var(--r-sm)]" />
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonBlock key={i} className="h-24 rounded-[var(--r-lg)]" />
              ))}
            </div>
          ))}
        </div>
      );
    /* One big canvas: the map, the planner, the gallery. */
    case "chart":
      return <SkeletonBlock className="h-[60vh] rounded-[var(--r-2xl)]" />;
    /* A column of fields. */
    case "form":
      return (
        <div className="flex max-w-2xl flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} className="h-14 rounded-[var(--r-lg)]" />
          ))}
        </div>
      );
    case "rows":
    default:
      return <SkeletonRows rows={7} />;
  }
}
