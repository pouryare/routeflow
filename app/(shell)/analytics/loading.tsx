import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /analytics starts.
 *
 *  The header card is the REAL one, not a grey box: its title and overview are static data,
 *  so the correct page name is on screen before the pool query runs. Only the body is a
 *  placeholder. This works at all because app/(shell)/layout.tsx is synchronous — a layout
 *  that awaits runtime data blocks navigation and never shows this file.
 *
 *  /analytics shipped without one of these, which is what tests/pageMeta.test.ts caught: the
 *  page is entirely client-side, so a navigation to it showed nothing at all until its own
 *  effect had run and the shell header had already painted.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/analytics")} />
      <PageSkeleton shape="rows" />
    </>
  );
}
