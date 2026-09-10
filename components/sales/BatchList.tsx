import Link from "next/link";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { BATCH_STATUS_LABEL } from "@/lib/batchStates";
import type { BatchStatus } from "@/lib/batchStates";

export type BatchListRow = {
  id: number;
  batch_code: string;
  product: string;
  produced_at: string | null;
  expiry_date: string | null;
  on_hand: number;
  status: BatchStatus;
};

/** The batch list, on the inventory page it belongs to (item 18).
 *
 *  The user asked whether /sales/batches should live under انبار. Partly: a batch is a
 *  stock lot, so the list of them is inventory and sits here with the stock it makes up.
 *  But a batch also carries a safety workflow (quarantine → release → recall) that stock
 *  does not, so the actions keep their own focused page, one link away. Burying a recall
 *  inside a stock table is how a recall gets missed.
 *
 *  Server component. Dates are Jalali; statuses are Persian. */
export default function BatchList({ rows, canManage }: { rows: BatchListRow[]; canManage: boolean }) {
  return (
    <section className="card p-[var(--space-4)]" aria-labelledby="batch-list-heading">
      <SectionHead
        id="batch-list-heading"
        title="بچ‌ها"
        sub={rows.length === 0 ? "هنوز بچی ثبت نشده است." : `${faNum(rows.length)} بچ، زودتر منقضی‌شونده اول`}
        actions={
          canManage ? (
            <Link className="btn ghost" href="/sales/batches">
              قرنطینه، آزادسازی و فراخوان <Icon name="chevron-left" size="sm" />
            </Link>
          ) : null
        }
      />
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[length:var(--text-sm)]">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="border-b border-[var(--border)] py-2 text-right font-medium">بچ</th>
                <th className="border-b border-[var(--border)] py-2 text-right font-medium">کالا</th>
                <th className="border-b border-[var(--border)] py-2 text-right font-medium">تولید</th>
                <th className="border-b border-[var(--border)] py-2 text-right font-medium">انقضا</th>
                <th className="border-b border-[var(--border)] py-2 text-left font-medium">موجودی</th>
                <th className="border-b border-[var(--border)] py-2 text-left font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="border-b border-[var(--border)] py-2 font-mono text-[var(--text)]">{b.batch_code}</td>
                  <td className="border-b border-[var(--border)] py-2 text-[var(--text)]">{b.product}</td>
                  <td className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
                    {b.produced_at ? faJalaliDate(b.produced_at) : "—"}
                  </td>
                  <td className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
                    {b.expiry_date ? faJalaliDate(b.expiry_date) : "—"}
                  </td>
                  <td className="border-b border-[var(--border)] py-2 text-left tabular-nums">{faNum(b.on_hand)}</td>
                  <td className="border-b border-[var(--border)] py-2 text-left text-[var(--text-muted)]">
                    {BATCH_STATUS_LABEL[b.status] ?? "نامشخص"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
