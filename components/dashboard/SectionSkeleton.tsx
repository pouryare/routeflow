import { SkeletonBlock } from "@/components/Skeleton";

/** Reserves a dashboard section's space while it streams in, so the page below it does not
 *  jump when the real content arrives. Server component: no state, no effects. */
export default function SectionSkeleton({ height }: { height: string }) {
  return (
    <div aria-hidden="true">
      <SkeletonBlock className={`${height} w-full`} />
    </div>
  );
}
