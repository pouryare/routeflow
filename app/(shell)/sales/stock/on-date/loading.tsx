import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/stock/on-date starts: the real header card, a placeholder body. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/stock/on-date")} />
      <PageSkeleton route="/sales/stock/on-date" shape="rows" />
    </>
  );
}
