import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /switch starts.
 *
 *  The header card is the REAL one, not a grey box: its title and overview are static
 *  data, so the correct page name is on screen before any query runs. Only the body is a
 *  placeholder — which is the honest shape here, since the account list is fetched on the
 *  client and there is nothing server-side to wait for.
 *
 *  This works at all because app/(shell)/layout.tsx is synchronous — a layout that awaits
 *  runtime data blocks navigation and never shows this file.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/switch")} />
      <PageSkeleton route="/switch" shape="rows" />
    </>
  );
}
