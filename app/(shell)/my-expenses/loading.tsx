import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /my-expenses starts: the real header card, a placeholder body. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/my-expenses")} />
      <PageSkeleton route="/my-expenses" shape="rows" />
    </>
  );
}
