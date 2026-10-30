import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /sales/orders/[id] starts.
 *
 *  A single record has no pageMeta key of its own, so this borrows /sales/orders's header card
 *  on purpose -- the same convention accounting/ledger/[accountId]/loading.tsx documents.
 *  Only works because app/(shell)/layout.tsx is synchronous.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/sales/orders")} />
      <PageSkeleton route="/sales/orders/[id]" shape="form" />
    </>
  );
}
