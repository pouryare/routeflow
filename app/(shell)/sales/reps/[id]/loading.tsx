import PageSkeleton from "@/components/meridian/PageSkeleton";

/** Shown the instant a navigation to /sales/reps/[id] starts.
 *
 *  No header card, unlike the other detail routes: this page renders its own title block
 *  inside its card rather than the section's PageHeader, so a card here would paint and
 *  then vanish when the page arrives. Only works because app/(shell)/layout.tsx is
 *  synchronous.
 */
export default function Loading() {
  return <PageSkeleton shape="form" />;
}
