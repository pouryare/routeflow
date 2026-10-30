import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/admin/holidays starts.
 *
 *  Same shape as every other admin loading file: the REAL header card, because its title and
 *  overview are static data and the correct page name should be on screen before any query
 *  runs. Only the body is a placeholder.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/admin/holidays")} />
      <PageSkeleton route="/sales/admin/holidays" shape="rows" />
    </>
  );
}
