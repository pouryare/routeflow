import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /accounting/payables starts.
 *
 *  The header card is the REAL one, not a grey box: its title and overview are static
 *  data, so the correct page name is on screen before any query runs. Only the body is a
 *  placeholder. This works at all because app/(shell)/layout.tsx is synchronous.
 *
 *  The detail routes () borrow their parent's card on purpose -- there is no
 *  pageMeta key for an individual account or supplier, and inventing one would give the
 *  header a title that does not match the thing you are looking at.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/accounting/payables")} />
      <PageSkeleton route="/accounting/payables" shape="rows" />
    </>
  );
}
