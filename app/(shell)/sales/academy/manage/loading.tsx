import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/academy/manage")} />
      <PageSkeleton route="/sales/academy/manage" shape="rows" />
    </>
  );
}
