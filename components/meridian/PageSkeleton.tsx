import { SkeletonBlock, SkeletonLabel } from "@/components/Skeleton";
import { CAPTURES, type Capture, type CapturedBone } from "@/lib/skeletons";

/** The body of a route's loading state, shaped like the page that is coming.
 *
 *  **Captured first.** `route` names the page; when `npm run skeletons:capture` has
 *  recorded it (lib/skeletons/, boneyard's snapshot of the real page on the demo data),
 *  this draws that page's own boxes, so the placeholder is the page's actual layout and
 *  nothing moves when the data lands. Rerun the capture after a page's layout changes.
 *
 *  **Five fallback shapes** for a route with no capture yet. A skeleton's job is to
 *  reserve the right amount of space in roughly the right arrangement; past that,
 *  detail is cost without benefit.
 *
 *  **Silhouettes, not tile scatters (item 20).** Each fallback shape is at most four
 *  shimmering masses: the board used to be twelve small tiles and the grid five, which
 *  read as "multiple tiny cards" rather than as a page about to appear. A capture keeps
 *  the same spirit by drawing the page's cards as plain card surfaces and shimmering only
 *  the lines inside them. tests/page-skeleton.test.ts pins both.
 *
 *  Server component: no state, no effects, so it paints before any script loads.
 */
export const PAGE_SHAPES = ["rows", "grid", "board", "chart", "form"] as const;
export type PageShape = (typeof PAGE_SHAPES)[number];

export default function PageSkeleton({ shape = "rows", route }: { shape?: PageShape; route?: string }) {
  const capture = route ? CAPTURES[route] : undefined;
  return (
    <>
      <SkeletonLabel />
      <div aria-hidden="true">{capture ? <Captured capture={capture} /> : body(shape)}</div>
    </>
  );
}

/** The phone capture below the md breakpoint and the desktop one above it, switched by
 *  CSS so the server can send both without knowing the screen. */
function Captured({ capture }: { capture: Capture }) {
  const { phone, desktop } = capture;
  if (!desktop) return <Bones layout={phone} />;
  return (
    <>
      <Bones layout={phone} className="md:hidden" />
      <Bones layout={desktop} className="hidden md:block" />
    </>
  );
}

/* Positions are physical `left`, not inline-start: the capture read them off the page as
   it was drawn right to left, so they are already where the RTL page puts things.
   `position` is inline because the unlayered `.skeleton { position: relative }` in
   globals.css outranks Tailwind's layered `absolute`. */
function Bones({ layout, className = "" }: { layout: Capture["phone"]; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height: layout.height }}>
      {layout.bones.map((b, i) => {
        const [x, y, w, h, r, card] = b as CapturedBone;
        const style = { position: "absolute" as const, left: `${x}%`, top: y, width: `${w}%`, height: h, borderRadius: r };
        return card ? (
          <span key={i} className="block border border-border bg-surface" style={style} />
        ) : (
          <SkeletonBlock key={i} style={style} />
        );
      })}
    </div>
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
