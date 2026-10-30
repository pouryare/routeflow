import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/crm")} />
      <PageSkeleton route="/crm" shape="chart" />
    </>
  );
}
