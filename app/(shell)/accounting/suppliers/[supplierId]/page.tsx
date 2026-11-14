import { Icon } from "@/components/meridian/Icon";
import { withRunningBalance } from "@/lib/runningBalance";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { supplierStatement } from "@/lib/repo/reports";
import { supplierOf } from "@/lib/repo/suppliers";
import { pageMetadata } from "@/lib/pageMeta";
import type { Metadata } from "next";
import { faNum } from "@/lib/format";
import SupplierPrices from "@/components/accounting/SupplierPrices";
import { allSupplierPrices } from "@/lib/repo/supplierPrices";
import { supplierOrdersForScore } from "@/lib/repo/purchaseOrders";
import { scorecard } from "@/lib/supplierScore";
import { activeProducts } from "@/lib/repo/stockPageView";

export const dynamic = "force-dynamic";

/** One supplier's statement: every movement on their account, with a running balance.
 *
 *  Reads both legs — 2101 (what we owe) and 1301 (what we prepaid) — because a supplier
 *  we hold a credit balance with is not the same as one we owe nothing to, and printing
 *  only the payable would show the second as a stranger. The running balance is what
 *  reconciles the two. */
/** The supplier's name in the tab, read in the caller's company after the same gate as the page. */
export async function generateMetadata({ params }: { params: Promise<{ supplierId: string }> }): Promise<Metadata> {
  const organizationId = await requireAccounting("/accounting/suppliers");
  const id = Number((await params).supplierId);
  const supplier = Number.isInteger(id) && id > 0 ? await supplierOf(organizationId, id) : undefined;
  return supplier ? { title: supplier.name } : pageMetadata("/accounting/suppliers");
}

export default async function SupplierStatementPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  const organizationId = await requireAccounting("/accounting/suppliers");

  const id = Number(supplierId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const supplier = await supplierOf(organizationId, id);
  if (!supplier) notFound();

  const rows = await supplierStatement(organizationId, id);
  const prices = (await allSupplierPrices(organizationId)).filter((p) => p.supplier_id === id);
  const products = (await activeProducts(organizationId)).map((p) => ({ id: p.id, name: p.name }));

  const { lines, closingToman: running } = withRunningBalance(rows, "C");
  const score = scorecard(await supplierOrdersForScore(organizationId, id));

  return (
    <>
      <PageHeader route="/accounting/suppliers" />
      <SectionHead
        title={supplier.name}
        sub={
          <>
            مانده {faNum(running)} تومان{lines.length ? "" : " — هنوز گردشی ندارد"}
          </>
        }
        actions={
          <Link
            href="/accounting/suppliers"
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-sm)]"
          >
            <Icon name="arrow-right" size="sm" />
            بازگشت به تأمین‌کنندگان
          </Link>
        }
      />

      {score.finished > 0 ? (
        <p className="m-0 mb-[var(--space-3)] text-[length:var(--text-sm)]" data-tour="supplier-score">
          {score.judged > 0 ? `${faNum(score.onTime)} از ${faNum(score.judged)} سفارش به موقع رسیده${score.avgLateDays > 0 ? `؛ دیرکردها به‌طور میانگین ${faNum(score.avgLateDays)} روز` : ""}` : "هنوز سفارشی با تاریخ انتظار تمام نشده"}
          {score.closedShort > 0 ? ` · ${faNum(score.closedShort)} سفارش با کسری بسته شد` : ""}
        </p>
      ) : null}

      <SupplierPrices supplierId={id} rows={prices.map((p) => ({ product_id: p.product_id, product_name: p.product_name, price_toman: p.price_toman, min_qty: p.min_qty, delivery_days: p.delivery_days, supplier_code: p.supplier_code }))} products={products} />

      <AcctTable
        head={["سند", "تاریخ", "شرح", "حساب", "بدهکار", "بستانکار", "مانده"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>جمع</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={NUM}>{faNum(running)}</td>
          </tr>
        }
      >
        {lines.map((r) => (
          <tr key={`${r.journalId}-${r.code}-${r.side}`} className="border-t border-border">
            <td className={`${CELL} tnum`}>#{r.seq}</td>
            <td className={CELL}>
              <span className="tnum">{r.postedAt.slice(0, 10)}</span>
            </td>
            <td className={CELL}>{r.memo ?? r.sourceType}</td>
            <td className={CELL}>
              <span className="tnum">{r.code}</span> {r.nameFa}
            </td>
            <td className={NUM}>{r.side === "D" ? faNum(r.amountToman) : "—"}</td>
            <td className={NUM}>{r.side === "C" ? faNum(r.amountToman) : "—"}</td>
            <td className={NUM}>{faNum(r.balanceToman)}</td>
          </tr>
        ))}
      </AcctTable>
    </>
  );
}