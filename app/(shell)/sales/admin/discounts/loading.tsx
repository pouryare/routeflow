import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/admin/discounts starts.
 *
 *  The header card is the REAL one, not a grey box: its title and overview are static
 *  data, so the correct page name is on screen before any query runs. Only the body is a
 *  placeholder. This works at all because app/(shell)/layout.tsx is synchronous — a
 *  layout that awaits runtime data blocks navigation and never shows this file.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/admin/discounts")} />
      <PageSkeleton route="/sales/admin/discounts" shape="rows" />
    </>
  );
}
