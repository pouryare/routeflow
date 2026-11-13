import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isOwner } from "@/lib/roles";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import PurchaseOrderCard from "@/components/sales/PurchaseOrderCard";
import { listPurchaseOrders } from "@/lib/repo/purchaseOrders";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/stock/orders");

export const dynamic = "force-dynamic";

/** F66: purchase orders, the open ones first (late ones at the very top); «همه» adds the finished and cancelled. */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isOwner(session.role)) redirect("/sales/stock");
  const all = (await searchParams).all === "1";
  const orders = await listPurchaseOrders(session.organizationId, { open: !all });
  return (
    <>
      <PageHeader route="/sales/stock/orders" />
      <SectionHead title="سفارش‌های خرید" sub={orders.length ? undefined : all ? "هنوز سفارش خریدی ثبت نشده است." : "سفارشی در راه نیست. از «فهرست خرید» پیش‌نویس بسازید."} />
      <div className="mb-[var(--space-3)] flex flex-wrap gap-[var(--space-3)] text-[length:var(--text-sm)]">
        <Link href="/sales/stock/orders" aria-current={all ? undefined : "page"} className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]">در راه</Link>
        <Link href="/sales/stock/orders?all=1" aria-current={all ? "page" : undefined} className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]">همه</Link>
        <Link href="/sales/stock/buy-list" className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]">فهرست خرید</Link>
      </div>
      {orders.map((o) => <PurchaseOrderCard key={o.id} order={o} />)}
    </>
  );
}
