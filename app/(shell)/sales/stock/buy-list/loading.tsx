import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/stock/buy-list starts: the real header card, a placeholder body. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/stock/buy-list")} />
      <PageSkeleton route="/sales/stock/buy-list" shape="rows" />
    </>
  );
}
