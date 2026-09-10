import { SkeletonBlock, SkeletonLabel } from "@/components/Skeleton";

/** The body of a route's loading state, shaped like the page that is coming.
 *
 *  Five shapes rather than thirty-four bespoke files. A skeleton's job is to reserve the
 *  right amount of space in roughly the right arrangement so nothing jumps when the data
 *  lands; past that, detail is cost without benefit.
 *
 *  **Silhouettes, not tile scatters (item 20).** Each shape is at most four shimmering
 *  masses: the board used to be twelve small tiles and the grid five, which read as
 *  "multiple tiny cards" rather than as a page about to appear.
 *  tests/page-skeleton.test.ts caps the count per shape.
 *
 *  Server component: no state, no effects.
 */
export const PAGE_SHAPES = ["rows", "grid", "board", "chart", "form"] as const;
export type PageShape = (typeof PAGE_SHAPES)[number];

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
    /* A stat strip over one big panel: dashboards and day views. */
    case "grid":
      return (
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-80" />
        </div>
      );
    /* Three tall columns: the assignment board, the order pipeline, run lanes. */
    case "board":
      return (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, c) => (
            <SkeletonBlock key={c} className="h-[26rem]" />
          ))}
        </div>
      );
    /* One big canvas: the map, the planner, the gallery. */
    case "chart":
      return <SkeletonBlock className="h-[60vh]" />;
    /* A form is one card of fields. */
    case "form":
      return <SkeletonBlock className="h-[26rem] max-w-2xl" />;
    /* A toolbar over one list card. */
    case "rows":
    default:
      return (
        <div className="flex flex-col gap-4">
          <SkeletonBlock className="h-11 w-full max-w-md" />
          <SkeletonBlock className="h-[28rem]" />
        </div>
      );
  }
}
