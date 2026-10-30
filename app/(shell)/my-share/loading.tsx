import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/my-share")} />
      <PageSkeleton route="/my-share" shape="rows" />
    </>
  );
}
