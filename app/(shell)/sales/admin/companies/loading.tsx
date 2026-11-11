import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/admin/companies starts: the real header card, a placeholder body.
 *  No captured skeleton yet (npm run skeletons:capture), so it draws the "rows" shape. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/admin/companies")} />
      <PageSkeleton route="/sales/admin/companies" shape="rows" />
    </>
  );
}
