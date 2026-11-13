import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /accounting/money starts: the real header card, a placeholder body. */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/accounting/money")} />
      <PageSkeleton route="/accounting/money" shape="rows" />
    </>
  );
}
