import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/admin/data starts: the real header, a placeholder body. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/admin/data")} />
      <PageSkeleton route="/sales/admin/data" shape="rows" />
    </>
  );
}
