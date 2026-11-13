import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orgScopeId } from "@/lib/session";
import { isOwner } from "@/lib/roles";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import { stockPositionIn } from "@/lib/repo/routeAdapters";
import { allSupplierPrices } from "@/lib/repo/supplierPrices";
import { buyList } from "@/lib/buyList";
import { faNum, faToman } from "@/lib/format";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/stock/buy-list");

export const dynamic = "force-dynamic";

/** D17, first slice: what to buy, grouped by the cheapest supplier. No purchase drafts yet (they come with purchase orders, F66). */
export default async function BuyListPage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isOwner(session.role)) redirect("/sales/stock");
  const stock = await stockPositionIn(orgScopeId(session));
  const prices = await allSupplierPrices(session.organizationId);
  const groups = buyList(
    stock.map((r) => ({ productId: r.product_id, name: r.name, unit: r.base_unit, onHand: r.on_hand, reorderPoint: r.reorder_point, target: r.target_stock, sellOff: r.sell_off })),
    prices.map((p) => ({ supplierId: p.supplier_id, supplier: p.supplier, productId: p.product_id, price: p.price_toman, minQty: p.min_qty, deliveryDays: p.delivery_days })),
  );
  return (
    <>
      <PageHeader route="/sales/stock/buy-list" />
      <SectionHead title="فهرست خرید" sub={groups.length ? "کالاهای رسیده به نقطهٔ سفارش، به تفکیک ارزان‌ترین تأمین‌کننده" : "فعلاً کالایی به نقطهٔ سفارش نرسیده است."} />
      {groups.map((g) => (
        <section key={g.supplier} className="card mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] p-[var(--space-4)]">
          <SectionHead
            as="h3"
            title={g.supplierId ? <Link href={`/accounting/suppliers/${g.supplierId}`} className="text-[var(--accent-text)]">{g.supplier}</Link> : g.supplier}
            sub={g.totalToman > 0 ? faToman(g.totalToman) : undefined}
          />
          <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
            {g.lines.map((l) => (
              <li key={l.productId} className="flex justify-between gap-2">
                <span>{l.name}</span>
                <span className="tnum">{faNum(l.qty)} {l.unit}{l.deliveryDays !== null ? ` · ${faNum(l.deliveryDays)} روزه` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
