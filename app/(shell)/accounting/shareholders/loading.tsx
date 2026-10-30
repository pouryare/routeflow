import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** The real header card at once; only the body is a placeholder (see accounting/suppliers/loading). */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/accounting/shareholders")} />
      <PageSkeleton route="/accounting/shareholders" shape="rows" />
    </>
  );
}
