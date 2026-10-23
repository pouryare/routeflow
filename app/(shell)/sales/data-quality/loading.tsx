import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/data-quality starts; the header card is the real one. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/data-quality")} />
      <PageSkeleton shape="rows" />
    </>
  );
}
