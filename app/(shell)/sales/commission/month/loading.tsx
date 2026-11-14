import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to the monthly pay sheet starts. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/commission/month")} />
      <PageSkeleton route="/sales/commission/month" shape="rows" />
    </>
  );
}
